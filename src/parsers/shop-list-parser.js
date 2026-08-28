import { extractHydrationData, deepFindAll } from './hydration.js';
import { config, productUrl, coerceProductUrl } from '../config.js';

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (value > 500 && Number.isInteger(value)) return value / 100;
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/[^\d.,]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? null : num;
  }
  if (typeof value === 'object') {
    return parsePrice(
      value.sale_price_decimal ||
        value.sale_price ||
        value.salePrice ||
        value.price ||
        value.amount ||
        value.min_price ||
        value.min_sale_price ||
        value.format_price ||
        value.sale_price_format
    );
  }
  return null;
}

function parseCompactCount(text) {
  if (text == null || text === '') return null;
  if (typeof text === 'number') return text;

  let t = String(text).toLowerCase().replace(/\+/g, '').replace(/[()]/g, '').trim();
  const kMatch = t.match(/^([\d.,]+)\s*k/);
  if (kMatch) {
    const n = parseFloat(kMatch[1].replace(',', '.'));
    return Number.isNaN(n) ? null : Math.round(n * 1000);
  }
  const mMatch = t.match(/^([\d.,]+)\s*m/);
  if (mMatch) {
    const n = parseFloat(mMatch[1].replace(',', '.'));
    return Number.isNaN(n) ? null : Math.round(n * 1000000);
  }
  const num = parseInt(t.replace(/\./g, '').replace(',', ''), 10);
  return Number.isNaN(num) ? null : num;
}

function parseRating(value) {
  if (value == null || value === '') return null;
  const num = parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(num) || num < 0 || num > 5) return null;
  return num;
}

function extractImage(raw) {
  if (raw.image_url) return raw.image_url;
  const images = raw.images || raw.image_list || raw.imageList || [];
  if (typeof images[0] === 'string') return images[0];
  if (images[0]?.url_list?.[0]) return images[0].url_list[0];
  if (images[0]?.url) return images[0].url;
  if (raw.image?.url_list?.[0]) return raw.image.url_list[0];
  if (raw.image?.url) return raw.image.url;
  return raw.cover?.url || raw.cover_url || null;
}

function flattenRawProduct(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const base = raw.product || raw.product_info || raw.productInfo || raw;
  const priceInfo = base.product_price_info || base.price_info || base.priceInfo || {};
  const rateInfo = base.rate_info || base.rateInfo || base.review_info || {};
  const soldInfo = base.sold_info || base.soldInfo || base.sale_info || {};

  return {
    ...base,
    product_id: base.product_id || base.productId || base.id,
    title: base.title || base.product_name || base.name,
    price:
      priceInfo.sale_price_decimal ||
      priceInfo.sale_price ||
      priceInfo.min_sale_price ||
      priceInfo.format_price ||
      priceInfo.sale_price_format ||
      base.price,
    sold_count:
      soldInfo.sold_count ??
      soldInfo.soldCount ??
      soldInfo.sale_count ??
      base.sold_count ??
      base.soldCount,
    rating: rateInfo.score ?? rateInfo.rating ?? base.rating ?? base.rating_score,
    review_count:
      rateInfo.review_count ??
      rateInfo.reviewCount ??
      rateInfo.rating_count ??
      base.review_count ??
      base.rating_count,
    image_url: base.image_url || extractImage(base),
  };
}

function isProductListItem(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const flat = flattenRawProduct(obj);
  const id = String(flat.product_id || flat.productId || flat.id || '');
  const title = flat.title || flat.product_name || flat.name;
  return /^\d{15,20}$/.test(id) && Boolean(title);
}

function listProductQuality(product) {
  let score = 0;
  if (product.price != null) score += 5;
  if (product.soldCount != null) score += 5;
  if (product.rating != null) score += 2;
  if (product.ratingCount != null) score += 1;
  if (product.imageUrl) score += 1;
  if (product.sourceUrl?.includes('products_by_component')) score += 3;
  if (product.title) score += 1;
  return score;
}

function mergeListProduct(base, extra) {
  const pick = (a, b) => (a != null && a !== '' ? a : b);
  const merged = {
    ...base,
    title: pick(extra.title, base.title),
    price: pick(extra.price, base.price),
    soldCount: Math.max(base.soldCount || 0, extra.soldCount || 0) || pick(extra.soldCount, base.soldCount),
    rating: pick(extra.rating, base.rating),
    ratingCount: Math.max(base.ratingCount || 0, extra.ratingCount || 0) || pick(extra.ratingCount, base.ratingCount),
    imageUrl: pick(extra.imageUrl, base.imageUrl),
    productUrl: pick(extra.productUrl, base.productUrl),
    sourceUrl: pick(extra.sourceUrl, base.sourceUrl),
  };

  if (listProductQuality(extra) > listProductQuality(base)) {
    merged.sourceUrl = extra.sourceUrl || merged.sourceUrl;
  }

  return merged;
}

export function normalizeListProduct(raw, sourceUrl = null) {
  const flat = flattenRawProduct(raw);
  const productId = String(flat.product_id || flat.productId || flat.id || '');
  if (!/^\d{15,20}$/.test(productId)) return null;

  return {
    productId,
    title: flat.title || flat.product_name || flat.name || null,
    price: parsePrice(flat.price),
    soldCount: parseCompactCount(flat.sold_count ?? flat.soldCount ?? flat.sale_count) || null,
    rating: parseRating(flat.rating ?? flat.rating_score),
    ratingCount: parseCompactCount(flat.review_count ?? flat.rating_count ?? flat.ratingCount) || null,
    imageUrl: flat.image_url || extractImage(flat),
    productUrl: coerceProductUrl(flat.seo_url || flat.product_url, productId),
    sourceUrl,
  };
}

export function dedupeAndSortProducts(products, limit = 30) {
  const map = new Map();

  for (const product of products) {
    if (!product?.productId) continue;
    const existing = map.get(product.productId);
    if (!existing) {
      map.set(product.productId, product);
      continue;
    }
    map.set(product.productId, mergeListProduct(existing, product));
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        (b.soldCount || 0) - (a.soldCount || 0) ||
        (b.ratingCount || 0) - (a.ratingCount || 0) ||
        (b.rating || 0) - (a.rating || 0) ||
        (b.price || 0) - (a.price || 0)
    )
    .slice(0, limit);
}

function collectProductArrays(json) {
  const arrays = [];

  const visit = (node, depth = 0) => {
    if (!node || depth > 12) return;

    if (Array.isArray(node)) {
      const hasProducts = node.some(
        (item) => isProductListItem(item) || (item?.product && isProductListItem(item.product))
      );
      if (hasProducts) arrays.push(node);
      for (const item of node) visit(item, depth + 1);
      return;
    }

    if (typeof node === 'object') {
      for (const value of Object.values(node)) visit(value, depth + 1);
    }
  };

  visit(json);
  return arrays;
}

export function parseProductListFromJson(json, options = {}) {
  if (!json || typeof json !== 'object') return [];

  const seen = new Set();
  const products = [];

  const add = (raw) => {
    const normalized = normalizeListProduct(raw, options.sourceUrl);
    if (!normalized || seen.has(normalized.productId)) return;
    seen.add(normalized.productId);
    products.push(normalized);
  };

  const listCandidates = [
    json?.data?.products,
    json?.data?.product_list,
    json?.data?.items,
    json?.data?.feed,
    json?.products,
    json?.product_list,
    json?.items,
    json?.feed,
  ];

  for (const list of listCandidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) add(item.product || item);
  }

  for (const list of collectProductArrays(json)) {
    for (const item of list) add(item.product || item);
  }

  for (const item of deepFindAll(json, isProductListItem)) {
    add(item);
  }

  return products;
}

export function parseProductListFromHtml(html, options = {}) {
  const products = [];
  const seen = new Set();

  const hydration = extractHydrationData(html);
  if (hydration) {
    products.push(...parseProductListFromJson(hydration.data, options));
  }

  for (const match of html.matchAll(/\/pdp\/(\d{15,20})/gi)) {
    const productId = match[1];
    if (seen.has(productId)) continue;
    seen.add(productId);
    products.push({
      productId,
      title: null,
      price: null,
      soldCount: null,
      rating: null,
      ratingCount: null,
      imageUrl: null,
      productUrl: productUrl(productId, config.region),
      sourceUrl: options.sourceUrl,
    });
  }

  return products;
}

export async function parseProductListFromDom(page) {
  const items = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    for (const link of document.querySelectorAll('a[href*="/pdp/"]')) {
      const match = link.href.match(/\/pdp\/(\d{15,20})/i);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);

      const card =
        link.closest('[data-e2e], [class*="product"], [class*="Product"], [class*="card"]') ||
        link.parentElement?.parentElement?.parentElement;

      const title =
        link.getAttribute('title') ||
        card?.querySelector('h2, h3, h4, [class*="Title"], [class*="title"]')?.textContent?.trim() ||
        null;

      const text = card?.innerText || '';
      const priceMatch = text.match(/R\$\s*([\d.,]+)/);
      const soldMatch = text.match(/([\d.,]+[kKmM]?)\s*vendid[oa]/i);

      let ratingText = null;
      const ratingRow = card?.querySelector('.flex.flex-row.items-center');
      if (ratingRow?.querySelector('svg')) {
        const candidate = ratingRow.querySelector('.H2-Semibold, .H3-Semibold')?.textContent?.trim();
        if (candidate && /^\d([.,]\d)?$/.test(candidate.replace(',', '.'))) {
          ratingText = candidate;
        }
      }

      results.push({
        productId: match[1],
        title,
        priceText: priceMatch?.[1] || null,
        soldText: soldMatch?.[1] || null,
        ratingText,
        productUrl: link.href.split('?')[0],
      });
    }

    return results;
  });

  return items.map((item) =>
    normalizeListProduct(
      {
        product_id: item.productId,
        title: item.title,
        price: item.priceText,
        sold_text: item.soldText,
        rating: item.ratingText,
      },
      item.productUrl
    )
  );
}
