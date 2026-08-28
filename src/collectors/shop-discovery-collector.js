import { config } from '../config.js';
import { attachNetworkCapture } from '../browser/stealth-context.js';
import { persistStorageState } from '../session/anonymous-session.js';
import { openBrowserSession, warmUpSession } from '../browser/stealth-context.js';
import {
  dedupeAndSortProducts,
  parseProductListFromDom,
  parseProductListFromHtml,
  parseProductListFromJson,
} from '../parsers/shop-list-parser.js';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

export const DISCOVERY_SOURCES = {
  trending: 'Produtos em destaque na home do Shop',
  popular: 'Produtos em destaque na home do Shop',
  search: 'Busca por palavra-chave no Shop',
  deals: 'Ofertas / promoções do Shop',
};

export function shopDiscoveryUrl(source = 'trending', options = {}) {
  const region = (options.region || config.region).toLowerCase();
  const query = options.query || 'achadinhos';

  switch (source) {
    case 'search':
      return `https://www.tiktok.com/shop/search?q=${encodeURIComponent(query)}&region=${region}`;
    case 'deals':
      return `https://shop.tiktok.com/${region}/deals`;
    case 'popular':
    case 'trending':
    default:
      return `https://www.tiktok.com/shop?region=${region}`;
  }
}

async function scrollPage(page, scrolls = 6) {
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await page.waitForTimeout(1200);
  }
}

function collectFromCapturedResponses(captured, sourceUrl) {
  const products = [];

  for (const entry of captured.rawResponses || []) {
    products.push(...parseProductListFromJson(entry.json, { sourceUrl: entry.url || sourceUrl }));
  }

  return products;
}

function isOnTargetPage(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.hostname !== target.hostname) return false;
    if (current.pathname !== target.pathname) return false;
    return current.search === target.search;
  } catch {
    return currentUrl.includes(targetUrl);
  }
}

async function discoverOnPage(page, options = {}) {
  const limit = options.limit ?? 30;
  const sourceUrl = options.url;
  const scrolls = options.scrolls ?? 6;
  const products = [];

  const captured = attachNetworkCapture(page, {
    onResponse: (_url, json) => {
      products.push(...parseProductListFromJson(json, { sourceUrl: _url }));
    },
  });

  if (options.navigate) {
    console.log(`   🌐 Abrindo ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(4000);
  } else {
    console.log(`   🔗 Usando aba já aberta: ${page.url()}`);
    await page.waitForTimeout(2000);
  }

  await scrollPage(page, scrolls);
  products.push(...collectFromCapturedResponses(captured, sourceUrl));

  const html = await page.content();
  products.push(...parseProductListFromHtml(html, { sourceUrl }));
  products.push(...(await parseProductListFromDom(page)));

  const ranked = dedupeAndSortProducts(products, limit);

  return {
    products: ranked,
    pageTitle: await page.title(),
    sourceUrl: page.url(),
    captureStats: {
      networkResponses: captured.rawResponses.length,
      rawCandidates: products.length,
    },
  };
}

/**
 * Descobre produtos populares conectando no Chrome do usuário (CDP).
 */
export async function discoverPopularProductsViaCdp(options = {}) {
  const source = options.source || 'trending';
  const url = options.url || shopDiscoveryUrl(source, options);
  const { chromium } = await import('playwright');

  let browser;
  try {
    browser = await chromium.connectOverCDP(options.cdpUrl || CDP_URL);
  } catch (error) {
    throw new Error(
      `Não conectou ao Chrome em ${CDP_URL}. Rode scripts\\abrir-chrome-debug.cmd primeiro. Detalhe: ${error.message}`
    );
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('Chrome conectado mas sem contexto — abra uma aba no Chrome');
  }

  const context = contexts[0];
  let page = context.pages().find((p) => /tiktok\.com\/shop|shop\.tiktok\.com/i.test(p.url()));

  if (!page) {
    page = context.pages()[0] || (await context.newPage());
  }

  const alreadyOnTarget = isOnTargetPage(page.url(), url);

  const result = await discoverOnPage(page, {
    ...options,
    url,
    navigate: options.forceNavigate || !alreadyOnTarget,
  });

  const storageState = await context.storageState();
  await persistStorageState(storageState);

  return {
    success: result.products.length > 0,
    mode: 'cdp',
    source,
    query: options.query || null,
    ...result,
    error: result.products.length > 0 ? null : 'Nenhum produto encontrado — abra a home do TikTok Shop no Chrome e role a página',
  };
}

/**
 * Descobre produtos via Playwright (visível ou headless).
 */
export async function discoverPopularProductsViaBrowser(options = {}) {
  const source = options.source || 'trending';
  const url = options.url || shopDiscoveryUrl(source, options);
  const session = await openBrowserSession({ visible: Boolean(options.visible) });

  try {
    if (!options.skipWarmup) {
      await warmUpSession(session.page, { warmupUrl: url, warmupDelayMs: 4000 });
    }

    const result = await discoverOnPage(session.page, {
      ...options,
      url,
      navigate: true,
    });

    const storageState = await session.getStorageState();
    await persistStorageState(storageState);

    return {
      success: result.products.length > 0,
      mode: options.visible ? 'visible' : 'headless',
      source,
      query: options.query || null,
      ...result,
      error: result.products.length > 0 ? null : 'Nenhum produto encontrado na página do Shop',
    };
  } finally {
    await session.close();
  }
}

export async function discoverPopularProducts(options = {}) {
  if (options.cdp !== false) {
    try {
      return await discoverPopularProductsViaCdp(options);
    } catch (error) {
      if (!options.fallbackBrowser) throw error;
      console.log(`   ⚠️  CDP falhou (${error.message}) — tentando browser...`);
    }
  }

  return discoverPopularProductsViaBrowser(options);
}
