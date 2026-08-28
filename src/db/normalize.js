import { config } from '../config.js';

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function normalizeProductForStorage(product, extra = {}) {
  const now = new Date().toISOString();
  return stripUndefined({
    productId: product.productId,
    title: product.title || null,
    description: product.description || null,
    price: product.price ?? null,
    originalPrice: product.originalPrice ?? null,
    discountPct: product.discountPct ?? null,
    currency: product.currency || 'BRL',
    soldCount: product.soldCount ?? null,
    stock: product.stock ?? null,
    rating: product.rating ?? null,
    ratingCount: product.ratingCount ?? null,
    ratingDistribution: product.ratingDistribution || null,
    imageUrl: product.imageUrl || product.images?.[0] || null,
    images: product.images || [],
    skus: product.skus || [],
    shop: product.shop || null,
    productUrl: product.productUrl || null,
    source: extra.source || product.source || null,
    query: extra.query || null,
    rankPosition: extra.rankPosition ?? product.rankPosition ?? null,
    enriched: Boolean(extra.enriched ?? product.enriched),
    detailSource: product.detailSource || null,
    scrapedAt: product.scrapedAt || now,
    updatedAt: now,
  });
}

export function buildDiscoveryRunPayload(result, meta = {}) {
  const products = result.products || [];
  return {
    type: 'discover',
    source: result.summary?.source || meta.source || 'trending',
    query: result.summary?.query || meta.query || null,
    region: config.region,
    mode: result.discovery?.mode || meta.mode || 'cdp',
    discovered: products.length,
    enriched: result.summary?.enriched || 0,
    collectedAt: result.collectedAt || new Date().toISOString(),
    productIds: products.map((p) => p.productId),
    summary: result.summary || {},
    captureStats: result.discovery?.captureStats || null,
    ...meta,
  };
}
