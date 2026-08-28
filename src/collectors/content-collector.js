import { config, normalizeHashtag, sleep, TIKTOK_HEADERS } from '../config.js';
import { extractHydrationData } from '../parsers/hydration.js';
import { parseHashtagPage, parseVideoList } from '../parsers/hashtag-parser.js';
import {
  fetchChallengeDetail,
  fetchChallengeItemList,
  fetchChallengeItemListViaBrowser,
} from './tiktok-api.js';
import { collectHashtagViaCdp } from './cdp-content-collector.js';
import {
  getOrRefreshAnonymousSession,
  getSessionSummary,
  buildCookieHeader,
} from '../session/anonymous-session.js';

function hashtagUrl(tag) {
  const normalized = normalizeHashtag(tag);
  return `https://www.tiktok.com/tag/${encodeURIComponent(normalized)}`;
}

async function fetchHashtagHtml(tag, session) {
  const url = hashtagUrl(tag);
  const cookieHeader = session ? buildCookieHeader(session.storageState) : null;

  const response = await fetch(url, {
    headers: {
      ...TIKTOK_HEADERS,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao buscar hashtag #${tag}: ${url}`);
  }

  return { url, html: await response.text() };
}

function buildResult(hashtag, videos, meta = {}) {
  const productIds = [...new Set(videos.map((v) => v.productId).filter(Boolean))];

  return {
    hashtag,
    success: videos.length > 0,
    videos,
    productIds,
    stats: {
      totalVideos: videos.length,
      videosWithProduct: productIds.length,
    },
    ...meta,
    ...(videos.length === 0 && {
      error:
        meta.error ||
        'Nenhum vídeo encontrado — TikTok pode estar bloqueando este IP. Tente proxy BR ou rede residencial.',
    }),
  };
}

/**
 * Coleta vídeos de uma hashtag via sessão anônima.
 * Estratégias: API assinada → browser network capture → HTML hydration.
 */
export async function collectHashtag(tag, options = {}) {
  const maxVideos = options.maxVideos ?? config.maxVideosPerHashtag;
  const normalized = normalizeHashtag(tag);
  const usePlaywright = options.usePlaywright ?? true;

  if (options.cdp !== false && (options.cdp || process.env.USE_CDP === 'true')) {
    try {
      return await collectHashtagViaCdp(normalized, options);
    } catch (error) {
      if (options.cdpOnly) {
        return buildResult(normalized, [], {
          source: 'cdp',
          error: error.message,
        });
      }
      console.log(`   ⚠️  CDP falhou (${error.message}) — tentando sessão anônima...`);
    }
  }

  let session = await getOrRefreshAnonymousSession(options);
  const sessionSummary = getSessionSummary(session);

  // Estratégia 1: API challenge/detail + item_list com sessão anônima
  try {
    const challenge = await fetchChallengeDetail(normalized, session);
    const itemListResult = await fetchChallengeItemList(
      challenge.challengeId,
      0,
      maxVideos,
      session
    );

    if (itemListResult.itemList.length > 0) {
      const videos = parseVideoList(itemListResult.itemList, normalized, maxVideos);
      return buildResult(normalized, videos, {
        source: itemListResult.source || 'signed-api',
        challengeId: challenge.challengeId,
        challengeStats: challenge.stats,
        sessionSummary,
      });
    }
  } catch {
    // continua
  }

  // Estratégia 2: Browser stealth + network capture (sem login)
  if (usePlaywright) {
    try {
      const browserResult = await fetchChallengeItemListViaBrowser(normalized, maxVideos, options);
      if (browserResult.itemList.length > 0) {
        const videos = parseVideoList(browserResult.itemList, normalized, maxVideos);
        return buildResult(normalized, videos, {
          source: browserResult.source,
          sourceUrl: hashtagUrl(normalized),
          sessionSummary,
        });
      }
    } catch {
      // continua
    }
  }

  // Estratégia 3: HTML hydration via fetch com cookies anônimos
  try {
    session = await getOrRefreshAnonymousSession({ ...options, forceRefresh: true });
    const { url, html } = await fetchHashtagHtml(normalized, session);
    const hydration = extractHydrationData(html);

    if (hydration) {
      const videos = parseHashtagPage(hydration, normalized, maxVideos);
      if (videos.length > 0) {
        return buildResult(normalized, videos, {
          source: 'anonymous-session-hydration',
          sourceUrl: url,
          hydrationSource: hydration.source,
          sessionSummary: getSessionSummary(session),
        });
      }
    }
  } catch {
    // continua
  }

  return buildResult(normalized, [], {
    source: 'none',
    sessionSummary,
    error: 'TikTok bloqueou a coleta neste IP. Configure PROXY_URL se persistir.',
  });
}

/**
 * Coleta vídeos de múltiplas hashtags com delay entre requisições.
 */
export async function collectHashtags(tags, options = {}) {
  const delay = options.delayMs ?? config.requestDelayMs;
  const results = [];
  const allVideos = [];
  const allProductIds = new Set();

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    try {
      const result = await collectHashtag(tag, options);
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

    if (i < tags.length - 1) {
      await sleep(delay);
    }
  }

  return {
    collectedAt: new Date().toISOString(),
    hashtags: tags.map(normalizeHashtag),
    results,
    videos: allVideos,
    productIds: [...allProductIds],
    summary: {
      totalHashtags: tags.length,
      successfulHashtags: results.filter((r) => r.success).length,
      totalVideos: allVideos.length,
      uniqueProductIds: allProductIds.size,
    },
  };
}
