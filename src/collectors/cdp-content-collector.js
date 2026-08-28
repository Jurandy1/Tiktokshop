import { config, normalizeHashtag } from '../config.js';
import { attachNetworkCapture } from '../browser/stealth-context.js';
import { persistStorageState } from '../session/anonymous-session.js';
import { extractHydrationData, deepFind, deepFindAll } from '../parsers/hydration.js';
import {
  parseHashtagPage,
  parseVideoList,
  parseVideosFromApiPayload,
  parseVideosFromDom,
  sortVideosByViral,
  filterValidVideos,
  filterShopVideos,
  getVideoProductId,
  buildProductIdMap,
  applyProductIdMap,
  isLikelyShopVideo,
  isHashtagPageUnavailable,
} from '../parsers/hashtag-parser.js';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

export function hashtagUrl(tag) {
  const normalized = normalizeHashtag(tag);
  return `https://www.tiktok.com/tag/${encodeURIComponent(normalized)}`;
}

function isOnHashtagPage(currentUrl, tag) {
  const normalized = normalizeHashtag(tag);
  try {
    const path = new URL(currentUrl).pathname.replace(/\/$/, '');
    return path === `/tag/${normalized}`;
  } catch {
    return currentUrl.includes(`/tag/${normalized}`);
  }
}

async function getOrCreatePage(context) {
  const open = context.pages().find((page) => !page.isClosed());
  return open || context.newPage();
}

async function scrollHashtagFeed(page, scrolls = 8) {
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85));
    await page.waitForTimeout(1400);
  }
}

function isVideoStruct(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const id = obj.id || obj.awemeId || obj.videoId;
  const hasAuthor = obj.author || obj.authorInfo;
  const hasStats = obj.stats || obj.statsV2;
  return Boolean(id && (hasStats || hasAuthor));
}

async function waitForHydrationScript(page, timeoutMs = 15000) {
  try {
    await page.waitForFunction(
      () => {
        for (const id of ['SIGI_STATE', '__UNIVERSAL_DATA_FOR_REHYDRATION__']) {
          const el = document.getElementById(id);
          if (el?.textContent && el.textContent.length > 100) return true;
        }
        return false;
      },
      { timeout: timeoutMs }
    );
  } catch {
    // segue sem hydration
  }
}

async function extractProductIdFromVideoDom(page) {
  return page.evaluate(() => {
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.href || '';
      const match = href.match(/shop\.tiktok\.com\/[^"']*\/pdp\/(\d{15,20})/i);
      if (match) return match[1];
    }

    const text = document.body?.innerText || '';
    const inline = text.match(/shop\.tiktok\.com\/[^\s]*\/pdp\/(\d{15,20})/i);
    if (inline) return inline[1];

    return null;
  });
}

function extractProductIdFromCapture(captured, videoId) {
  for (const entry of captured.rawResponses || []) {
    const matches = deepFindAll(
      entry.json,
      (node) =>
        isVideoStruct(node) && String(node.id || node.awemeId || node.videoId) === videoId
    );
    for (const raw of matches) {
      const productId = getVideoProductId(raw);
      if (productId) return productId;
    }
  }

  for (const entry of captured.rawResponses || []) {
    const anyProduct = deepFind(entry.json, (node) => {
      if (!node || typeof node !== 'object') return false;
      const id = node.productId || node.product_id || node.extra?.product_id;
      return id && /^\d{15,20}$/.test(String(id));
    });
    if (anyProduct) {
      return String(anyProduct.productId || anyProduct.product_id || anyProduct.extra?.product_id);
    }
  }

  return null;
}

async function probeSingleVideoProduct(page, video) {
  if (!video.videoUrl || video.productId) return video.productId || null;

  const captured = attachNetworkCapture(page, {});

  await page.goto(video.videoUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitForHydrationScript(page, 12000);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1500);

  const fromDom = await extractProductIdFromVideoDom(page);
  if (fromDom) return fromDom;

  const fromNetwork = extractProductIdFromCapture(captured, video.videoId);
  if (fromNetwork) return fromNetwork;

  const html = await page.content();
  const hydration = extractHydrationData(html);
  if (hydration) {
    const matches = deepFindAll(
      hydration.data,
      (node) => isVideoStruct(node) && String(node.id || node.awemeId || node.videoId) === video.videoId
    );
    for (const raw of matches) {
      const productId = getVideoProductId(raw);
      if (productId) return productId;
    }

    const anyProduct = deepFind(hydration.data, (node) => {
      if (!node || typeof node !== 'object') return false;
      const id = node.productId || node.product_id || node.extra?.product_id;
      return id && /^\d{15,20}$/.test(String(id));
    });
    if (anyProduct) {
      return String(anyProduct.productId || anyProduct.product_id || anyProduct.extra?.product_id);
    }
  }

  const shopMatch = html.match(/shop\.tiktok\.com\/[^"']*\/pdp\/(\d{15,20})/i);
  if (shopMatch) return shopMatch[1];

  return null;
}

async function probeVideosForProduct(page, videos, options = {}) {
  const limit = options.probeLimit ?? 20;
  const contextHashtag = options.contextHashtag || null;
  const shopCandidates = sortVideosByViral(filterShopVideos(videos, contextHashtag)).filter(
    (video) => !video.productId && video.videoUrl
  );
  const otherCandidates = sortVideosByViral(videos).filter(
    (video) =>
      !video.productId &&
      video.videoUrl &&
      !isLikelyShopVideo(video, contextHashtag)
  );
  const candidates = [...shopCandidates, ...otherCandidates].slice(0, limit);

  if (!candidates.length) return videos;

  console.log(
    `   🔍 Abrindo ${candidates.length} vídeo(s) de shop para achar produto (${shopCandidates.length} com sinal de loja)...`
  );
  const byId = new Map(videos.map((video) => [video.videoId, { ...video }]));

  for (const video of candidates) {
    try {
      const productId = await probeSingleVideoProduct(page, video);
      if (productId) {
        const current = byId.get(video.videoId);
        if (current) current.productId = productId;
        console.log(`      🛒 @${video.author?.uniqueId || '?'} → ${productId}`);
        if (options.stopOnFirst) break;
      }
    } catch {
      // tenta próximo
    }
    await page.waitForTimeout(1200);
  }

  return filterValidVideos([...byId.values()]);
}

function collectVideosFromCapture(captured, hashtag, maxVideos) {
  const rawItems = [];

  for (const entry of captured.itemLists || []) {
    if (Array.isArray(entry)) {
      rawItems.push(...entry);
    } else if (entry && typeof entry === 'object') {
      rawItems.push(entry);
    }
  }

  for (const entry of captured.rawResponses || []) {
    rawItems.push(...parseVideosFromApiPayload(entry.json));
  }

  const productIdMap = buildProductIdMap(rawItems);
  const videos = applyProductIdMap(
    sortVideosByViral(parseVideoList(rawItems, hashtag)).slice(0, maxVideos),
    productIdMap
  );

  return filterValidVideos(videos);
}

function buildHashtagResult(hashtag, videos, meta = {}) {
  const sorted = filterValidVideos(sortVideosByViral(videos));
  const productIds = [...new Set(sorted.map((v) => v.productId).filter(Boolean))];

  return {
    hashtag,
    success: sorted.length > 0,
    videos: sorted,
    productIds,
    stats: {
      totalVideos: sorted.length,
      videosWithProduct: sorted.filter((v) => v.productId).length,
      uniqueProductIds: productIds.length,
      totalPlays: sorted.reduce((sum, v) => sum + (v.stats?.playCount || 0), 0),
    },
    ...meta,
    error:
      sorted.length === 0
        ? meta.error || 'Nenhum vídeo encontrado — abra a hashtag no Chrome e role o feed'
        : null,
  };
}

async function collectHashtagOnPage(page, tag, options = {}) {
  const normalized = normalizeHashtag(tag);
  const url = hashtagUrl(normalized);
  const maxVideos = options.maxVideos ?? config.maxVideosPerHashtag;
  const scrolls = options.scrolls ?? 10;

  const captured = attachNetworkCapture(page, {
    onResponse: (_apiUrl, json) => {
      const items = parseVideosFromApiPayload(json);
      if (items.length) captured.itemLists.push(...items);
    },
  });

  if (options.navigate) {
    console.log(`   🌐 Abrindo #${normalized}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(6000);
  } else {
    console.log(`   🔗 Usando aba: ${page.url()}`);
    await page.waitForTimeout(3000);
  }

  await scrollHashtagFeed(page, scrolls);
  await page.waitForTimeout(2500);
  await waitForHydrationScript(page, 12000);

  const pageTitle = await page.title();
  let html = await page.content();

  if (isHashtagPageUnavailable(pageTitle, html)) {
    console.log(`   ⚠️  Hashtag #${normalized} indisponível — pulando`);
    return {
      result: buildHashtagResult(normalized, [], {
        source: 'cdp-unavailable',
        sourceUrl: page.url(),
        pageTitle,
        unavailable: true,
        error: `Hashtag #${normalized} indisponível no TikTok`,
        captureStats: {
          networkResponses: captured.rawResponses.length,
          itemListItems: captured.itemLists.length,
          hydrationFound: false,
        },
      }),
      pageTitle,
    };
  }

  let videos = collectVideosFromCapture(captured, normalized, maxVideos);

  let hydration = extractHydrationData(html);
  if (!hydration) {
    await page.waitForTimeout(3000);
    html = await page.content();
    hydration = extractHydrationData(html);
  }
  if (hydration) {
    const fromHydration = parseHashtagPage(hydration, normalized, maxVideos);
    videos = mergeVideos(videos, fromHydration, maxVideos);
  }

  if (videos.length < maxVideos) {
    const fromDom = await parseVideosFromDom(page, normalized);
    videos = mergeVideos(videos, fromDom, maxVideos);
  }

  videos = filterValidVideos(videos);

  const needsProductProbe =
    options.probeForProduct &&
    videos.some((video) => !video.productId) &&
    videos.some((video) => video.videoUrl);

  if (needsProductProbe) {
    videos = await probeVideosForProduct(page, videos, {
      probeLimit: options.probeLimit ?? 20,
      stopOnFirst: Boolean(options.probeStopOnFirst),
      contextHashtag: normalized,
    });
    if (options.navigate !== false) {
      console.log(`   ↩️  Voltando para #${normalized}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2000);
    }
  }

  const finalPageTitle = await page.title();

  return {
    result: buildHashtagResult(normalized, videos, {
      source: videos.length ? 'cdp-network+hydration+dom' : 'cdp',
      sourceUrl: page.url(),
      pageTitle: finalPageTitle,
      captureStats: {
        networkResponses: captured.rawResponses.length,
        itemListItems: captured.itemLists.length,
        hydrationFound: Boolean(hydration),
      },
    }),
    pageTitle: finalPageTitle,
  };
}

function mergeVideos(base, extra, maxVideos) {
  const map = new Map();
  for (const video of [...base, ...extra]) {
    const existing = map.get(video.videoId);
    map.set(
      video.videoId,
      existing
        ? {
            ...existing,
            ...video,
            stats: { ...existing.stats, ...video.stats },
            productId: existing.productId || video.productId,
          }
        : video
    );
  }
  return filterValidVideos(sortVideosByViral([...map.values()])).slice(0, maxVideos);
}

/**
 * Coleta vídeos virais de uma hashtag via Chrome do usuário (CDP).
 */
export async function collectHashtagViaCdp(tag, options = {}) {
  const normalized = normalizeHashtag(tag);
  const url = hashtagUrl(normalized);
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
  let page =
    context.pages().find((p) => !p.isClosed() && isOnHashtagPage(p.url(), normalized)) ||
    (await getOrCreatePage(context));

  const { result, pageTitle } = await collectHashtagOnPage(page, normalized, {
    ...options,
    navigate: options.forceNavigate || !isOnHashtagPage(page.url(), normalized),
  });

  const storageState = await context.storageState();
  await persistStorageState(storageState);

  return {
    ...result,
    mode: 'cdp',
    pageTitle,
    sourceUrl: url,
  };
}

export async function collectHashtagsViaCdp(tags, options = {}) {
  const results = [];
  const allVideos = [];
  const allProductIds = new Set();

  for (const tag of tags) {
    try {
      const result = await collectHashtagViaCdp(tag, options);
      results.push(result);
      allVideos.push(...result.videos);
      for (const id of result.productIds) allProductIds.add(id);
    } catch (error) {
      results.push({
        hashtag: normalizeHashtag(tag),
        success: false,
        error: error.message,
        videos: [],
        productIds: [],
      });
    }
  }

  const videos = sortVideosByViral(allVideos);

  return {
    collectedAt: new Date().toISOString(),
    mode: 'cdp',
    hashtags: tags.map(normalizeHashtag),
    results,
    videos,
    productIds: [...allProductIds],
    summary: {
      totalHashtags: tags.length,
      successfulHashtags: results.filter((r) => r.success).length,
      totalVideos: videos.length,
      videosWithProduct: videos.filter((v) => v.productId).length,
      uniqueProductIds: allProductIds.size,
    },
  };
}
