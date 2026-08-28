import { deepFind } from '../parsers/hydration.js';
import { parseProductPage, normalizeProductFromPartial } from '../parsers/product-parser.js';
import { extractProductFromHtml, extractProductFromDom } from '../parsers/shop-dom-parser.js';
import { resolveProductInput, coerceProductUrl, extractProductId, sleep } from '../config.js';
import { attachNetworkCapture } from '../browser/stealth-context.js';
import { persistStorageState } from '../session/anonymous-session.js';
import { extractHydrationData } from '../parsers/hydration.js';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

function isProductStruct(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    (obj.product_id || obj.productId || obj.id) &&
    (obj.title || obj.product_name || obj.name)
  );
}

function parseProductFromApiPayload(json) {
  const candidates = [
    json?.data?.product,
    json?.data?.productInfo,
    json?.product,
    json?.productInfo,
    deepFind(json, isProductStruct),
  ];
  for (const candidate of candidates) {
    if (candidate && isProductStruct(candidate)) return candidate;
  }
  return null;
}

function mergeProducts(base, extra) {
  if (!extra) return base;
  return {
    ...base,
    title: base.title || extra.title,
    description: base.description || extra.description,
    price: base.price ?? extra.price,
    originalPrice: base.originalPrice ?? extra.originalPrice,
    discountPct: base.discountPct ?? extra.discountPct,
    soldCount: base.soldCount || extra.soldCount || null,
    stock: base.stock || extra.stock || null,
    rating: base.rating ?? extra.rating,
    ratingCount: base.ratingCount || extra.ratingCount || null,
    ratingDistribution: base.ratingDistribution || extra.ratingDistribution || null,
    images: base.images?.length ? base.images : extra.images,
    shop: base.shop || extra.shop,
    productUrl: extra.productUrl || base.productUrl,
  };
}

function getRawProductId(raw) {
  return String(raw?.product_id || raw?.productId || raw?.id || '');
}

function findMatchingNetworkRaw(captured, targetId) {
  for (const raw of captured.products || []) {
    if (getRawProductId(raw) === targetId) return raw;
  }

  for (const entry of captured.rawResponses || []) {
    const found = deepFind(
      entry.json,
      (node) => isProductStruct(node) && getRawProductId(node) === targetId
    );
    if (found) return found;
  }

  return null;
}

function buildProductFromRaw(raw, productId, pageUrl) {
  return finalizeProduct(normalizeProductFromPartial(raw, productId, pageUrl), productId, pageUrl);
}

function finalizeProduct(product, targetId, pageUrl) {
  if (!product) return null;
  return {
    ...product,
    productId: targetId,
    productUrl: pageUrl || product.productUrl,
  };
}

function resolveCdpTarget(productId, urlHint) {
  const id = extractProductId(productId);
  const url = coerceProductUrl(urlHint, id);
  return { productId: id, url };
}

function findProductPage(context, targetUrl) {
  const url = String(targetUrl || '');
  const targetId = url.match(/(\d{15,20})/)?.[1];
  if (!targetId) return context.pages()[0] || null;

  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    if (page.url().includes(targetId)) return page;
  }
  return context.pages().find((page) => !page.isClosed()) || null;
}

async function getOrCreatePage(context, preferredPage = null) {
  if (preferredPage && !preferredPage.isClosed()) return preferredPage;

  const open = context.pages().find((page) => !page.isClosed());
  if (open) return open;

  return context.newPage();
}

async function collectProductOnPage(page, productId, url, options = {}) {
  const { productId: id, url: targetUrl } = resolveCdpTarget(productId, url);
  const quiet = Boolean(options.quiet);

  const captured = attachNetworkCapture(page, {
    onProduct: parseProductFromApiPayload,
  });

  let currentUrl = '';
  try {
    currentUrl = page.url();
  } catch {
    currentUrl = '';
  }

  const alreadyOnProduct = currentUrl.includes(id);

  if (alreadyOnProduct) {
    if (!quiet) console.log(`   🔗 Usando aba já aberta do produto ${id}`);
    await page.waitForTimeout(2000);
  } else {
    if (!quiet) console.log(`   🔗 Navegando para produto ${id}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(6000);
  }

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(1500);

  const pageTitle = await page.title();
  const html = await page.content();
  const pageUrl = page.url();

  let product = null;
  let source = 'cdp';

  product = extractProductFromHtml(html, id);
  if (product) source = 'cdp-html-scan';

  const networkRaw = findMatchingNetworkRaw(captured, id);
  if (networkRaw) {
    const fromNetwork = buildProductFromRaw(networkRaw, id, pageUrl);
    product = product ? mergeProducts(fromNetwork, product) : fromNetwork;
    source = product && source !== 'cdp' ? `${source}+network` : 'cdp-network';
  }

  if (!product) {
    const hydration = extractHydrationData(html);
    if (hydration) {
      try {
        product = finalizeProduct(parseProductPage(hydration, id), id, pageUrl);
        source = 'cdp-hydration';
      } catch {
        const raw = deepFind(
          hydration.data,
          (node) => isProductStruct(node) && getRawProductId(node) === id
        );
        if (raw) {
          product = buildProductFromRaw(raw, id, pageUrl);
          source = 'cdp-hydration-deep';
        }
      }
    }
  }

  const fromDom = await extractProductFromDom(page, id);
  if (fromDom) {
    product = product ? mergeProducts(product, fromDom) : fromDom;
    if (source === 'cdp') source = 'cdp-dom';
    else if (!product.price || !product.soldCount) source = `${source}+dom`;
  }

  product = finalizeProduct(product, id, pageUrl);

  if (product && product.title) {
    return {
      productId: id,
      sourceUrl: pageUrl,
      source,
      pageTitle,
      success: true,
      product,
    };
  }

  const lower = html.toLowerCase();
  let error = 'Produto não encontrado na página';
  if (pageTitle.toLowerCase().includes('entrar')) {
    error = 'TikTok redirecionou para login';
  } else if (lower.includes('muita frequência') || lower.includes('muita frequencia')) {
    error = 'Rate limit — espere 30–60 min';
  }

  return {
    productId: id,
    sourceUrl: pageUrl,
    source: 'cdp',
    pageTitle,
    success: false,
    error,
    product: null,
  };
}

/**
 * Conecta ao Chrome que VOCÊ já abriu (com login/captcha resolvido manualmente).
 */
export async function collectProductViaCdp(productId, options = {}) {
  if (options.page) {
    return collectProductOnPage(options.page, productId, options.url, options);
  }

  const { productId: id, url } = resolveCdpTarget(productId, options.url);
  const cdpUrl = options.cdpUrl || CDP_URL;
  const { chromium } = await import('playwright');

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error(
      `Não conectou ao Chrome em ${cdpUrl}. Rode scripts\\abrir-chrome-debug.cmd primeiro. Detalhe: ${error.message}`
    );
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('Chrome conectado mas sem contexto — abra uma aba no Chrome');
  }

  const context = contexts[0];
  const page = await getOrCreatePage(context, findProductPage(context, url));
  const result = await collectProductOnPage(page, id, url, options);

  const storageState = await context.storageState();
  await persistStorageState(storageState);

  return result;
}

/**
 * Enriquece vários produtos reutilizando uma única conexão CDP (mais estável).
 */
export async function collectProductsViaCdp(items, options = {}) {
  const cdpUrl = options.cdpUrl || CDP_URL;
  const delayMs = options.delayMs ?? 2000;
  const { chromium } = await import('playwright');

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error(
      `Não conectou ao Chrome em ${cdpUrl}. Rode scripts\\abrir-chrome-debug.cmd primeiro. Detalhe: ${error.message}`
    );
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('Chrome conectado mas sem contexto — abra uma aba no Chrome');
  }

  const context = contexts[0];
  let page = await getOrCreatePage(context);
  const results = [];

  for (const item of items) {
    const productId = typeof item === 'string' ? item : item.productId;
    const urlHint = typeof item === 'object' ? item.productUrl || item.url : null;

    try {
      page = await getOrCreatePage(context, page);
      const result = await collectProductOnPage(page, productId, urlHint, {
        quiet: options.quiet ?? true,
      });
      results.push(result);
      if (result.success) {
        console.log(`   ✅ ${result.product.title?.slice(0, 50) || productId}`);
      } else {
        console.log(`   ⚠️  ${productId}: ${result.error}`);
      }
    } catch (error) {
      results.push({
        productId: extractProductId(productId),
        success: false,
        error: error.message,
        product: null,
      });
      console.log(`   ⚠️  ${productId}: ${error.message}`);
      page = await getOrCreatePage(context);
    }

    await sleep(delayMs);
  }

  const storageState = await context.storageState();
  await persistStorageState(storageState);

  return results;
}
