import { deepFind, deepFindAll, getByPath } from './hydration.js';

const KNOWN_HASHTAG_PATHS = [
  '__DEFAULT_SCOPE__.webapp.hashtag-detail.itemList',
  '__DEFAULT_SCOPE__.webapp.challenge-detail.itemList',
  'ItemModule',
  'ItemList',
];

function isVideoStruct(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const id = obj.id || obj.awemeId || obj.videoId;
  const hasAuthor = obj.author || obj.authorInfo;
  const hasStats = obj.stats || obj.statsV2;
  return Boolean(id && (hasStats || hasAuthor));
}

function extractProductId(video) {
  const candidates = [
    video?.anchors,
    video?.anchorInfos,
    video?.anchorList,
    video?.commerceInfo?.productInfo,
    video?.commerceInfo,
    video?.commerce_info,
    video?.productInfo,
    video?.poiInfo?.productInfo,
    video?.tt_anchor,
  ];

  for (const source of candidates) {
    if (!source) continue;

    if (Array.isArray(source)) {
      for (const anchor of source) {
        const id =
          anchor?.productId ||
          anchor?.product_id ||
          anchor?.extra?.product_id ||
          anchor?.extra?.productId ||
          anchor?.component_key ||
          anchor?.id;
        if (id && /^\d{15,20}$/.test(String(id))) return String(id);
      }
    } else if (typeof source === 'object') {
      const id = source.productId || source.product_id || source.id;
      if (id && /^\d{15,20}$/.test(String(id))) return String(id);
    }
  }

  const anchorWithProduct = deepFind(video, (node) => {
    if (!node || typeof node !== 'object') return false;
    const id =
      node.productId ||
      node.product_id ||
      node.extra?.product_id ||
      node.extra?.productId;
    return id && /^\d{15,20}$/.test(String(id));
  });

  if (anchorWithProduct) {
    return String(
      anchorWithProduct.productId ||
        anchorWithProduct.product_id ||
        anchorWithProduct.extra?.product_id
    );
  }

  const blob = JSON.stringify(video);
  const urlMatch = blob.match(/(?:product|pdp)[/_](\d{15,20})/i);
  if (urlMatch) return urlMatch[1];

  return null;
}

export function getVideoProductId(video) {
  return extractProductId(video);
}

export function isValidCollectedVideo(video) {
  const id = String(video?.videoId || '');
  if (!/^\d{15,20}$/.test(id)) return false;

  const author = video?.author?.uniqueId;
  const description = video?.description?.trim();
  const plays = Number(video?.stats?.playCount || 0);

  if (!author && !description && !video?.productId) return false;
  if (plays > 2_000_000_000) return false;

  return true;
}

export function filterValidVideos(videos) {
  return videos.filter(isValidCollectedVideo);
}

const SHOP_HASHTAGS = new Set([
  'tiktokshop',
  'tiktokshopbrasil',
  'achadinhos',
  'achadinhosdashopee',
  'achadosshopee',
  'comprastiktok',
  'comprinhas',
  'produtosvirais',
  'tiktokmademebuyit',
]);

const SHOP_CONTEXT_HASHTAGS = new Set([
  'achadinhos',
  'produtosvirais',
  'tiktokshop',
  'achadinhosdashopee',
  'comprinhas',
]);

const SHOP_TEXT_RE =
  /tiktok\s*shop|tiktokshop|achadinhos|achadinhos\s*da\s*shopee|link\s+(?:na\s+)?bio|compre\s+aqui|shop\.tiktok|\/pdp\//i;

export function isLikelyShopVideo(video, contextHashtag = null) {
  if (video?.productId) return true;

  const pageTag = String(contextHashtag || video?.hashtag || '')
    .toLowerCase()
    .replace(/^#/, '');
  if (pageTag && SHOP_CONTEXT_HASHTAGS.has(pageTag)) return true;

  const tags = (video?.hashtags || []).map((tag) => String(tag).toLowerCase());
  if (tags.some((tag) => SHOP_HASHTAGS.has(tag))) return true;

  const text = `${video?.description || ''} ${tags.map((t) => `#${t}`).join(' ')}`;
  return SHOP_TEXT_RE.test(text);
}

export function filterShopVideos(videos, contextHashtag = null) {
  return videos.filter((video) => isLikelyShopVideo(video, contextHashtag));
}

export function isHashtagPageUnavailable(pageTitle = '', html = '') {
  const title = String(pageTitle || '').toLowerCase();
  const body = String(html || '').toLowerCase();

  if (title.includes('indisponível') || title.includes('indisponivel')) return true;
  if (title.includes("isn't available") || title.includes('not available')) return true;

  const hasUnavailableText =
    body.includes('página indisponível') ||
    body.includes('pagina indisponivel') ||
    body.includes("page isn't available") ||
    body.includes("couldn't find this hashtag") ||
    body.includes('hashtag not found');

  const hasEmptyHashtagHint = body.includes('procurando vídeos? experimente navegar');

  // Só marca indisponível com mensagem explícita de erro (evita falso positivo no feed normal)
  if (hasUnavailableText && hasEmptyHashtagHint) return true;
  if (hasUnavailableText && !body.includes('itemmodule') && !body.includes('"itemlist"')) {
    return true;
  }

  return false;
}

export function buildProductIdMap(rawItems) {
  const map = new Map();

  for (const item of rawItems) {
    const normalized = item?.itemStruct || item?.item || item?.aweme_info || item;
    if (!normalized || typeof normalized !== 'object') continue;

    const videoId = String(normalized.id || normalized.awemeId || normalized.videoId || '');
    if (!/^\d{15,20}$/.test(videoId)) continue;

    const productId = extractProductId(normalized);
    if (productId) map.set(videoId, productId);
  }

  return map;
}

export function applyProductIdMap(videos, productIdMap) {
  if (!productIdMap?.size) return videos;
  return videos.map((video) => ({
    ...video,
    productId: video.productId || productIdMap.get(video.videoId) || null,
  }));
}

export function viralScore(video) {
  const stats = video.stats || {};
  return (
    Number(stats.playCount || 0) +
    Number(stats.diggCount || 0) * 8 +
    Number(stats.shareCount || 0) * 12 +
    Number(stats.commentCount || 0) * 3
  );
}

export function sortVideosByViral(videos) {
  return [...videos].sort((a, b) => viralScore(b) - viralScore(a));
}

export function annotateViralScores(videos) {
  return videos.map((video) => ({
    ...video,
    viralScore: viralScore(video),
  }));
}

/**
 * Filtra e retorna os vídeos mais virais (já com viralScore no objeto).
 */
export function getTopViralVideos(videos, options = {}) {
  const {
    top = 1,
    requireProductId = false,
    minPlayCount = 0,
  } = options;

  let filtered = videos;

  if (requireProductId) {
    filtered = filtered.filter((video) => video.productId);
  }

  if (minPlayCount > 0) {
    filtered = filtered.filter((video) => Number(video.stats?.playCount || 0) >= minPlayCount);
  }

  return annotateViralScores(sortVideosByViral(filtered)).slice(0, top);
}

export function getMostViralVideo(videos, options = {}) {
  const [winner] = getTopViralVideos(videos, { ...options, top: 1 });
  return winner || null;
}

export function parseVideosFromApiPayload(json) {
  if (!json || typeof json !== 'object') return [];

  const lists = [
    json.itemList,
    json?.data?.itemList,
    json?.data?.items,
    json?.items,
    json?.aweme_list,
    json?.data?.aweme_list,
  ].filter(Array.isArray);

  const raw = [];
  for (const list of lists) raw.push(...list);

  if (raw.length === 0) {
    const found = deepFindAll(json, (node) => {
      const id = node?.id || node?.awemeId || node?.videoId;
      return id && (node?.stats || node?.author || node?.authorInfo);
    });
    raw.push(...found);
  }

  return raw;
}

/**
 * Extrai links de vídeo visíveis na página da hashtag (fallback DOM).
 */
export async function parseVideosFromDom(page, hashtag) {
  const items = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    for (const link of document.querySelectorAll('a[href*="/video/"]')) {
      const match = link.href.match(/\/@([^/]+)\/video\/(\d+)/);
      if (!match || seen.has(match[2])) continue;
      seen.add(match[2]);

      const card = link.closest('[data-e2e], [class*="DivItemContainer"], [class*="video"]') || link.parentElement;
      const text = card?.innerText || '';
      const plays = text.match(/([\d.,]+[kKmM]?)\s*(?:views|visualiza)/i);
      const likes = text.match(/([\d.,]+[kKmM]?)\s*(?:likes|curtidas)/i);

      results.push({
        id: match[2],
        author: { uniqueId: match[1] },
        desc: link.getAttribute('title') || card?.querySelector('[data-e2e="video-desc"]')?.textContent?.trim() || '',
        stats: {
          playCount: plays?.[1] || 0,
          diggCount: likes?.[1] || 0,
        },
      });
    }

    return results;
  });

  return parseVideoList(items, hashtag);
}

function normalizeAuthor(author) {
  if (!author) return { uniqueId: null, nickname: null, verified: false };

  return {
    uniqueId: author.uniqueId || author.unique_id || author.id || null,
    nickname: author.nickname || author.nickName || null,
    verified: Boolean(author.verified),
  };
}

function normalizeStats(stats) {
  if (!stats) {
    return {
      playCount: 0,
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
      collectCount: 0,
    };
  }

  const parseMetric = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return Number(value ?? 0) || 0;
    const t = value.toLowerCase().replace(/\+/g, '').trim();
    const k = t.match(/^([\d.,]+)\s*k/);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const m = t.match(/^([\d.,]+)\s*m/);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000000);
    return parseInt(t.replace(/\./g, '').replace(',', ''), 10) || 0;
  };

  return {
    playCount: parseMetric(stats.playCount ?? stats.play_count ?? stats.viewCount),
    diggCount: parseMetric(stats.diggCount ?? stats.digg_count ?? stats.likeCount),
    commentCount: parseMetric(stats.commentCount ?? stats.comment_count),
    shareCount: parseMetric(stats.shareCount ?? stats.share_count),
    collectCount: parseMetric(stats.collectCount ?? stats.collect_count),
  };
}

function normalizeVideo(video, hashtag) {
  const videoId = String(video.id || video.awemeId || video.videoId);
  const author = normalizeAuthor(video.author || video.authorInfo);
  const stats = normalizeStats(video.stats);
  const productId = extractProductId(video);

  const createTime = video.createTime || video.create_time;
  const createdAt = createTime
    ? new Date(Number(createTime) * 1000).toISOString()
    : null;

  const hashtags = [];
  if (video.textExtra) {
    for (const extra of video.textExtra) {
      if (extra.hashtagName) hashtags.push(extra.hashtagName);
    }
  }
  if (video.challenges) {
    for (const challenge of video.challenges) {
      if (challenge.title) hashtags.push(challenge.title.replace(/^#/, ''));
    }
  }

  return {
    videoId,
    hashtag,
    description: video.desc || video.description || '',
    author,
    stats,
    productId,
    hashtags: [...new Set(hashtags)],
    createdAt,
    videoUrl: author.uniqueId
      ? `https://www.tiktok.com/@${author.uniqueId}/video/${videoId}`
      : null,
    coverUrl: video.video?.cover || video.video?.originCover || video.cover || null,
    musicTitle: video.music?.title || null,
    scrapedAt: new Date().toISOString(),
  };
}

function collectVideosFromItemModule(data) {
  const module = data.ItemModule;
  if (!module || typeof module !== 'object') return [];

  return Object.values(module).filter(isVideoStruct);
}

function collectVideosFromItemList(itemList) {
  if (!itemList) return [];

  if (Array.isArray(itemList)) {
    return itemList
      .map((item) => item?.itemStruct || item?.item || item)
      .filter(isVideoStruct);
  }

  if (typeof itemList === 'object') {
    if (Array.isArray(itemList.itemList)) {
      return collectVideosFromItemList(itemList.itemList);
    }
    return Object.values(itemList)
      .map((item) => item?.itemStruct || item?.item || item)
      .filter(isVideoStruct);
  }

  return [];
}

/**
 * Parseia uma lista de vídeos raw (API itemList ou hydration).
 */
export function parseVideoList(rawVideos, hashtag, maxVideos = 30) {
  const seen = new Set();
  const videos = [];

  for (const video of rawVideos) {
    const normalized = video?.itemStruct || video?.item || video?.aweme_info || video;
    if (!normalized?.id && !normalized?.awemeId && !normalized?.videoId) continue;

    const videoId = String(normalized.id || normalized.awemeId || normalized.videoId);
    if (seen.has(videoId)) continue;
    seen.add(videoId);

    const parsed =
      normalized.stats || normalized.author || normalized.authorInfo
        ? normalizeVideo(normalized, hashtag)
        : {
            videoId,
            hashtag,
            description: normalized.desc || normalized.description || '',
            author: normalizeAuthor(normalized.author || normalized.authorInfo),
            stats: normalizeStats(normalized.stats),
            productId: extractProductId(normalized),
            hashtags: [hashtag],
            createdAt: null,
            videoUrl: normalized.author?.uniqueId
              ? `https://www.tiktok.com/@${normalized.author.uniqueId}/video/${videoId}`
              : null,
            coverUrl: null,
            musicTitle: null,
            scrapedAt: new Date().toISOString(),
          };

    videos.push(parsed);
    if (videos.length >= maxVideos) break;
  }

  return videos;
}

/**
 * Parseia o hydration JSON de uma página de hashtag do TikTok.
 */
export function parseHashtagPage(hydrationData, hashtag, maxVideos = 30) {
  const { data } = hydrationData;
  let rawVideos = [];

  for (const path of KNOWN_HASHTAG_PATHS) {
    const node = getByPath(data, path);
    const videos = collectVideosFromItemList(node);
    if (videos.length > 0) {
      rawVideos = videos;
      break;
    }
  }

  if (rawVideos.length === 0) {
    rawVideos = collectVideosFromItemModule(data);
  }

  if (rawVideos.length === 0) {
    rawVideos = deepFindAll(data, isVideoStruct);
  }

  return parseVideoList(rawVideos, hashtag, maxVideos);
}
