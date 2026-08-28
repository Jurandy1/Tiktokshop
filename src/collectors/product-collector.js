import { config, productUrlLegacy, resolveProductInput, sleep, TIKTOK_HEADERS } from '../config.js';
import { extractHydrationData, deepFind } from '../parsers/hydration.js';
import { parseProductPage } from '../parsers/product-parser.js';
import {
  getOrRefreshAnonymousSession,
  getSessionSummary,
  buildCookieHeader,
  persistStorageState,
} from '../session/anonymous-session.js';
import {
  openBrowserSession,
  attachNetworkCapture,
  isSecurityCheck,
  isSecurityCheckContent,
  waitForCaptchaResolved,
  isRateLimitedContent,
} from '../browser/stealth-context.js';

function isProductStruct(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    (obj.product_id || obj.productId || obj.id) &&
    (obj.title || obj.product_name || obj.name) &&
    (obj.sold_count != null || obj.soldCount != null || obj.price != null)
  );
}

function parseProductFromApiPayload(json) {
  const candidates = [
    json?.data?.product,
    json?.data?.productInfo,
    json?.product,
    json?.productInfo,
    json?.initialData?.productInfo,
    deepFind(json, isProductStruct),
  ];

  for (const candidate of candidates) {
    if (candidate && isProductStruct(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildProductFromRaw(raw, productId) {
  const hydration = { source: 'api-network', data: { productInfo: raw } };
  return parseProductPage(hydration, productId);
}

function pageHasProductData(html, captured) {
  if (captured.products.length > 0) return true;
  const hydration = extractHydrationData(html);
  if (!hydration) return false;
  return Boolean(deepFind(hydration.data, isProductStruct));
}

async function loadProductPage(page, url, captured, options) {
  captured.products = [];
  captured.rawResponses = [];

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(options.visible ? 5000 : 4000);

  let pageTitle = await page.title();
  let html = await page.content();

  if (isRateLimitedContent(html)) {
    return {
      pageTitle,
      html,
      rateLimited: true,
    };
  }

  const needsCaptcha =
    isSecurityCheck(pageTitle) || isSecurityCheckContent(html);

  if (needsCaptcha) {
    await waitForCaptchaResolved(page, options);

    // Recarrega produto após captcha resolvido
    console.log('   🔄 Recarregando página do produto...');
    captured.products = [];
    captured.rawResponses = [];

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);

    pageTitle = await page.title();
    html = await page.content();
  }

  return { pageTitle, html, rateLimited: false };
}

async function fetchProductWithAnonymousSession(productId, options = {}) {
  const resolved = options.url
    ? { productId: String(productId), url: options.url }
    : resolveProductInput(productId);
  const { productId: id, url } = resolved;
  const urlsToTry = [url, productUrlLegacy(id)];

  if (options.visible) {
    console.log('   🌐 Abrindo Chrome real (perfil persistente)...');
  } else {
    console.log('   🤖 Browser headless em execução...');
  }

  const session = options.visible ? null : await getOrRefreshAnonymousSession(options);
  const browserSession = await openBrowserSession({
    ...options,
    storageState: session?.storageState,
  });
  const { page, close, getStorageState } = browserSession;

  try {
    const captured = attachNetworkCapture(page, {
      onProduct: parseProductFromApiPayload,
    });

    let pageTitle = '';
    let html = '';
    let finalUrl = urlsToTry[0];

    // Modo headless: warm-up antes do produto
    if (!options.visible) {
      const region = config.region.toLowerCase();
      await page.goto(`https://www.tiktok.com/shop?region=${region}`, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await page.waitForTimeout(2000);
    }

    for (const tryUrl of urlsToTry) {
      finalUrl = tryUrl;
      const loaded = await loadProductPage(page, tryUrl, captured, options);
      pageTitle = loaded.pageTitle;
      html = loaded.html;

      if (loaded.rateLimited) {
        break;
      }

      if (!isSecurityCheck(pageTitle) && pageHasProductData(html, captured)) {
        break;
      }
    }

    // Salva sessão pós-captcha para reutilizar nas próximas coletas
    const updatedState = await getStorageState();
    await persistStorageState(updatedState);

    return {
      url: finalUrl,
      html,
      pageTitle,
      capturedProducts: captured.products,
      rawResponses: captured.rawResponses,
      sessionSummary: getSessionSummary({
        refreshed: options.visible,
        keyCookies: Object.fromEntries(
          (updatedState.cookies || [])
            .filter((c) => ['msToken', 'ttwid', 's_v_web_id'].includes(c.name))
            .map((c) => [c.name, c.value])
        ),
        meta: { expiresAt: Date.now() + config.sessionTtlMs },
      }),
    };
  } finally {
    await close();
  }
}

async function fetchProductHtmlWithSession(productId, session, options = {}) {
  const { productId: id, url } = options.url
    ? { productId: String(productId), url: options.url }
    : resolveProductInput(productId);
  const cookieHeader = buildCookieHeader(session.storageState);

  const response = await fetch(url, {
    headers: {
      ...TIKTOK_HEADERS,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao buscar produto ${id}`);
  }

  return { url, html: await response.text() };
}

/**
 * Coleta dados de um produto do TikTok Shop via sessão anônima.
 */
export async function collectProduct(productId, options = {}) {
  const usePlaywright = options.usePlaywright ?? true;
  const { productId: id } = resolveProductInput(productId);

  const attempt = async (forceRefresh = false) => {
    const session = await getOrRefreshAnonymousSession({ ...options, forceRefresh });
    const sessionSummary = getSessionSummary(session);

    if (!options.playwrightOnly && !options.visible) {
      try {
        const pageData = await fetchProductHtmlWithSession(id, session, options);
        const hydration = extractHydrationData(pageData.html);

        if (hydration) {
          const product = parseProductPage(hydration, id);
          return {
            productId: id,
            sourceUrl: pageData.url,
            hydrationSource: hydration.source,
            source: 'anonymous-session-fetch',
            sessionSummary,
            success: true,
            product,
          };
        }
      } catch {
        // continua
      }
    }

    if (usePlaywright) {
      const pageData = await fetchProductWithAnonymousSession(id, {
        ...options,
        forceRefresh,
      });

      if (pageData.capturedProducts.length > 0) {
        const product = buildProductFromRaw(pageData.capturedProducts[0], id);
        return {
          productId: id,
          sourceUrl: pageData.url,
          source: 'anonymous-session-network',
          pageTitle: pageData.pageTitle,
          sessionSummary: pageData.sessionSummary,
          success: true,
          product,
        };
      }

      const hydration = extractHydrationData(pageData.html);
      if (hydration) {
        try {
          const product = parseProductPage(hydration, id);
          return {
            productId: id,
            sourceUrl: pageData.url,
            hydrationSource: hydration.source,
            source: 'anonymous-session-hydration',
            pageTitle: pageData.pageTitle,
            sessionSummary: pageData.sessionSummary,
            success: true,
            product,
          };
        } catch {
          // tenta deep find
          const raw = deepFind(hydration.data, isProductStruct);
          if (raw) {
            const product = buildProductFromRaw(raw, id);
            return {
              productId: id,
              sourceUrl: pageData.url,
              source: 'anonymous-session-hydration-deep',
              pageTitle: pageData.pageTitle,
              sessionSummary: pageData.sessionSummary,
              success: true,
              product,
            };
          }
        }
      }

      const isRateLimited = isRateLimitedContent(pageData.html);
      const isCaptcha =
        !isRateLimited &&
        (isSecurityCheck(pageData.pageTitle) || isSecurityCheckContent(pageData.html));
      const apiHits = pageData.rawResponses?.length ?? 0;

      return {
        productId: id,
        sourceUrl: pageData.url,
        source: 'anonymous-session',
        pageTitle: pageData.pageTitle,
        sessionSummary: pageData.sessionSummary,
        success: false,
        error: isRateLimited
          ? 'Rate limit do TikTok — aguarde 30–60 min antes de tentar de novo'
          : isCaptcha
            ? 'Captcha ainda ativo após resolução — tente de novo com --visible'
            : `JSON do produto não encontrado (APIs capturadas: ${apiHits})`,
        product: null,
        isCaptcha,
        isRateLimited,
      };
    }

    return {
      productId: id,
      success: false,
      error: 'Use --playwright para tentar via browser stealth',
      product: null,
    };
  };

  let result = await attempt(false);

  if (!result.success && result.isCaptcha && !result.isRateLimited && !options._retried && !options.visible) {
    result = await attempt(true);
    result.retried = true;
  }

  return result;
}

/**
 * Coleta múltiplos produtos com delay entre requisições.
 */
export async function collectProducts(productIds, options = {}) {
  const delay = options.delayMs ?? config.requestDelayMs;
  const usePlaywright = options.usePlaywright ?? true;
  const results = [];
  const products = [];

  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];

    try {
      const result = await collectProduct(productId, {
        ...options,
        usePlaywright,
        url: options.urls?.[productId],
      });
      results.push(result);
      if (result.product) products.push(result.product);
    } catch (error) {
      results.push({
        productId: String(productId),
        success: false,
        error: error.message,
        product: null,
      });
    }

    if (i < productIds.length - 1) {
      await sleep(delay);
    }
  }

  return {
    collectedAt: new Date().toISOString(),
    results,
    products,
    summary: {
      totalProducts: productIds.length,
      successfulProducts: results.filter((r) => r.success).length,
    },
  };
}
