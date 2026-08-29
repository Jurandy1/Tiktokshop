/**
 * Núcleo do coletor de vídeos-com-produto, via ScrapeCreators (mesmo scraper
 * que já usamos pra produtos, GET /v1/tiktok/search/hashtag — 1 crédito).
 *
 * Por quê não usar sessão anônima + Playwright direto no TikTok (era o plano
 * original, em video-collector-service/): testado de verdade e o TikTok não
 * serve mais vídeos de hashtag pra sessões anônimas (sem login) — nem a API
 * assinada, nem a página em HTML trazem a lista. Não é bloqueio de IP/região
 * (a sessão detectava region:BR certinho), é o conteúdo mesmo que sumiu pra
 * quem não está logado. ScrapeCreators contorna isso porque eles resolvem
 * esse problema do lado deles. Ver histórico do projeto pra mais contexto.
 */
import { searchHashtag } from './scrapecreators.js';
import { initFirebase, upsertVideoWithSnapshot, saveRun } from './firebase.js';

export const DEFAULT_VIDEO_HASHTAGS = ['tiktokshop', 'achadinhos'];

function deepFind(obj, predicate, maxDepth = 12, depth = 0) {
  if (!obj || depth > maxDepth) return undefined;
  if (predicate(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, predicate, maxDepth, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      const found = deepFind(value, predicate, maxDepth, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Extrai productId de um item aweme_list (mesma heurística de src/parsers/hashtag-parser.js). */
function extractProductId(video) {
  const candidates = [
    video?.anchors,
    video?.anchor_infos,
    video?.anchor_list,
    video?.bottom_products,
    video?.commerce_info?.product_info,
    video?.commerce_info,
  ];

  for (const source of candidates) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const anchor of source) {
        const id =
          anchor?.productId || anchor?.product_id || anchor?.extra?.product_id || anchor?.id;
        if (id && /^\d{15,20}$/.test(String(id))) return String(id);
      }
    } else if (typeof source === 'object') {
      const id = source.productId || source.product_id || source.id;
      if (id && /^\d{15,20}$/.test(String(id))) return String(id);
    }
  }

  const found = deepFind(video, (node) => {
    if (!node || typeof node !== 'object') return false;
    const id = node.productId || node.product_id || node.extra?.product_id;
    return Boolean(id && /^\d{15,20}$/.test(String(id)));
  });
  if (found) return String(found.productId || found.product_id || found.extra?.product_id);

  const blob = JSON.stringify(video);
  const urlMatch = blob.match(/(?:product|pdp)[/_](\d{15,20})/i);
  return urlMatch ? urlMatch[1] : null;
}

function viralScore(stats) {
  return (
    Number(stats.playCount || 0) +
    Number(stats.diggCount || 0) * 8 +
    Number(stats.shareCount || 0) * 12 +
    Number(stats.commentCount || 0) * 3
  );
}

function normalizeAwemeVideo(item, hashtag) {
  const videoId = String(item.aweme_id);
  const stats = item.statistics || {};
  const author = item.author || {};

  return {
    videoId,
    hashtag,
    description: item.desc || '',
    author: {
      uniqueId: author.unique_id || null,
      nickname: author.nickname || null,
      verified: Boolean(author.custom_verify || author.enterprise_verify_reason),
    },
    stats: {
      playCount: Number(stats.play_count || 0),
      diggCount: Number(stats.digg_count || 0),
      commentCount: Number(stats.comment_count || 0),
      shareCount: Number(stats.share_count || 0),
    },
    productId: extractProductId(item),
    videoUrl: author.unique_id ? `https://www.tiktok.com/@${author.unique_id}/video/${videoId}` : null,
    coverUrl: item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0] || null,
    createdAt: item.create_time ? new Date(Number(item.create_time) * 1000).toISOString() : null,
  };
}

/**
 * Enriquece vídeos com o título do produto quando ele já está no nosso
 * catálogo (products/{id}, salvo pela sync de produtos) — mas o productId
 * extraído direto do próprio vídeo (via anchors/commerce_info do TikTok) já
 * é confiável por si só. Exigir que o produto já exista no nosso catálogo
 * (formado só por algumas buscas por palavra-chave) descartaria quase tudo,
 * já que o universo de produtos em vídeos é muito maior do que o que a gente
 * já coletou via shopSearch.
 */
async function correlateWithProducts(videos, firestore) {
  const explicitIds = [...new Set(videos.map((v) => v.productId).filter(Boolean))];
  const knownById = new Map();
  await Promise.all(
    explicitIds.map(async (id) => {
      try {
        const doc = await firestore.collection('products').doc(id).get();
        if (doc.exists) knownById.set(id, doc.data());
      } catch {
        // segue sem enriquecer
      }
    })
  );

  return videos.map((video) => {
    if (!video.productId) return { ...video, productMatchType: 'none', productKnown: false, productTitle: null };
    const known = knownById.get(video.productId);
    return {
      ...video,
      productMatchType: 'explicit',
      productKnown: true,
      productTitle: known?.title || null,
    };
  });
}

/**
 * Busca vídeos por hashtag via ScrapeCreators, filtra só os que têm produto
 * confirmado no catálogo, calcula score de viral e grava no Firestore.
 */
export async function runVideoSync({
  hashtags = DEFAULT_VIDEO_HASHTAGS,
  region = 'BR',
  runId = `run-video-${Date.now()}`,
  source = 'scheduled',
} = {}) {
  const firestore = await initFirebase();
  const startedAt = new Date().toISOString();
  let allVideos = [];
  const perHashtag = [];

  for (const hashtag of hashtags) {
    try {
      const res = await searchHashtag(hashtag, { region });
      const videos = (res.aweme_list || []).map((item) => normalizeAwemeVideo(item, hashtag));
      allVideos.push(...videos);
      perHashtag.push({ hashtag, count: videos.length });
    } catch (err) {
      perHashtag.push({ hashtag, error: err.message });
    }
  }

  // Dedup por videoId (pode repetir entre hashtags)
  const dedup = new Map();
  for (const v of allVideos) dedup.set(v.videoId, v);
  allVideos = [...dedup.values()];

  const withProductId = allVideos.filter((v) => v.productId);
  const correlated = await correlateWithProducts(withProductId, firestore);
  const confirmed = correlated
    .filter((v) => v.productKnown)
    .map((v) => ({ ...v, viralScore: viralScore(v.stats) }))
    .sort((a, b) => b.viralScore - a.viralScore);

  let saved = 0;
  const errors = [];
  for (const video of confirmed) {
    try {
      await upsertVideoWithSnapshot(video, { runId });
      saved++;
    } catch (err) {
      errors.push({ videoId: video.videoId, error: err.message });
    }
  }

  await saveRun({
    runId,
    source,
    region,
    hashtags,
    perHashtag,
    totalVideosFound: allVideos.length,
    videosWithProductId: withProductId.length,
    videosWithProduct: confirmed.length,
    videosSaved: saved,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  console.log(
    `runVideoSync ${runId}: ${allVideos.length} vídeo(s), ${withProductId.length} com productId, ${confirmed.length} confirmados no catálogo, ${saved} salvos`
  );

  return { runId, totalVideosFound: allVideos.length, videosWithProduct: confirmed.length, saved, errors, ok: errors.length === 0 };
}
