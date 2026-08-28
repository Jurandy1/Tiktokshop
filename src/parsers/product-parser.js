import { deepFind, deepFindAll, getByPath } from './hydration.js';

const KNOWN_PRODUCT_PATHS = [
  '__DEFAULT_SCOPE__.webapp.product-detail.productInfo',
  '__DEFAULT_SCOPE__.webapp.product-detail',
  'productInfo',
  'initialData.productInfo',
];

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    // TikTok Shop costuma armazenar centavos (ex: 8990 = R$ 89,90)
    if (value > 500 && Number.isInteger(value)) return value / 100;
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? null : num;
  }
  if (typeof value === 'object') {
    return parsePrice(
      value.real_price ||
        value.sale_price ||
        value.salePrice ||
        value.price ||
        value.amount ||
        value.min_price ||
        value.minPrice ||
        value.sale_price_decimal ||
        value.format_price
    );
  }
  return null;
}

function normalizeRatingDistribution(distribution) {
  if (!distribution) return null;

  if (Array.isArray(distribution)) {
    const result = {};
    for (const item of distribution) {
      const star = item.rating || item.star || item.level;
      const count = item.count || item.review_count;
      if (star != null && count != null) result[String(star)] = Number(count);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  if (typeof distribution === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(distribution)) {
      if (/^[1-5]$/.test(key)) result[key] = Number(value);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  return null;
}

function normalizeSkus(skus) {
  if (!Array.isArray(skus)) return [];

  return skus.map((sku) => ({
    skuId: String(sku.sku_id || sku.skuId || sku.id || ''),
    skuName: sku.sku_name || sku.skuName || sku.name || null,
    price: parsePrice(sku.price || sku.sale_price),
    stock: Number(sku.stock ?? sku.available_quantity ?? sku.stockQuantity ?? 0),
    properties: sku.property_pairs || sku.propertyPairs || sku.specs || [],
  }));
}

function normalizeShop(shop) {
  if (!shop) return null;

  return {
    shopId: String(shop.shop_id || shop.shopId || shop.seller_id || shop.sellerId || ''),
    shopName: shop.shop_name || shop.shopName || shop.name || null,
    followers: shop.followers_count || shop.followersCount || shop.format_followers_count || null,
    totalSold: shop.sold_count || shop.soldCount || shop.format_global_sold_count || null,
    rating: shop.shop_rating || shop.rating || null,
    region: shop.region || shop.seller_region || null,
  };
}

function isProductStruct(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    (obj.product_id || obj.productId || obj.id) &&
    (obj.title || obj.product_name || obj.name)
  );
}

function normalizeProduct(raw, productId) {
  const id = String(raw.product_id || raw.productId || raw.id || productId);
  const priceInfo = raw.product_price_info || raw.priceInfo || raw.price || {};

  const salePrice = parsePrice(
    priceInfo.sale_price ||
      priceInfo.salePrice ||
      raw.sale_price ||
      raw.salePrice ||
      raw.price
  );

  const originalPrice = parsePrice(
    priceInfo.original_price ||
      priceInfo.originalPrice ||
      raw.original_price ||
      raw.originalPrice ||
      raw.list_price
  );

  const discountPct =
    salePrice && originalPrice && originalPrice > salePrice
      ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
      : raw.discount_pct || raw.discountPct || null;

  return {
    productId: id,
    title: raw.title || raw.product_name || raw.name || null,
    description: raw.description || raw.desc || null,
    price: salePrice,
    originalPrice,
    discountPct,
    currency: raw.currency || priceInfo.currency || 'BRL',
    soldCount: Number(raw.sold_count ?? raw.soldCount ?? raw.sale_count ?? 0) || null,
    stock: Number(raw.stock ?? raw.available_quantity ?? raw.stockCount ?? 0),
    rating: parseFloat(raw.rating ?? raw.rating_score ?? raw.product_rating ?? 0) || null,
    ratingCount: Number(raw.review_count ?? raw.ratingCount ?? raw.rating_count ?? 0),
    ratingDistribution: normalizeRatingDistribution(
      raw.rating_distribution || raw.ratingDistribution
    ),
    images: (raw.images || raw.image_list || [])
      .map((img) => (typeof img === 'string' ? img : img?.url_list?.[0] || img?.url))
      .filter(Boolean),
    skus: normalizeSkus(raw.skus || raw.sku_list || raw.skuVariants),
    shop: normalizeShop(raw.shop || raw.seller || raw.shop_info),
    productUrl: `https://www.tiktok.com/view/product/${id}`,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Normaliza produto a partir de dados parciais (DOM / script scan).
 */
export function normalizeProductFromPartial(raw, productId, productUrl = null) {
  const id = String(raw.product_id || raw.productId || raw.id || productId);
  const normalized = normalizeProduct(
    {
      ...raw,
      product_id: id,
      title: raw.title || raw.product_name || raw.name,
    },
    id
  );
  if (productUrl) normalized.productUrl = productUrl;
  return normalized;
}

/**
 * Parseia o hydration JSON de uma página de produto do TikTok Shop.
 */
export function parseProductPage(hydrationData, productId) {
  const { data } = hydrationData;
  let rawProduct = null;

  for (const path of KNOWN_PRODUCT_PATHS) {
    const node = getByPath(data, path);
    if (node && isProductStruct(node)) {
      rawProduct = node;
      break;
    }
  }

  if (!rawProduct) {
    rawProduct = deepFind(data, isProductStruct);
  }

  if (!rawProduct) {
    throw new Error(`Não foi possível localizar dados do produto ${productId} no JSON da página`);
  }

  return normalizeProduct(rawProduct, productId);
}

/**
 * Extrai productIds de uma lista de vídeos (saída da Fase 1).
 */
export function extractUniqueProductIds(videos) {
  const ids = new Set();
  for (const video of videos) {
    if (video.productId) ids.add(String(video.productId));
  }
  return [...ids];
}
