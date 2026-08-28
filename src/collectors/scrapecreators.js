/**
 * Cliente ScrapeCreators — TikTok Shop.
 *
 * Endpoints cobertos (todos custam 1 crédito):
 *   - GET /v1/tiktok/shop/search    → busca produtos por keyword+região
 *   - GET /v1/tiktok/shop/products  → lista produtos de uma LOJA específica
 *   - GET /v1/tiktok/product        → detalhes + related_videos (afiliados)
 *   - GET /v1/tiktok/search/hashtag → vídeos por hashtag
 *
 * Chave: env SCRAPECREATORS_API_KEY. Nunca hard-code aqui.
 */
import 'dotenv/config';

const BASE = 'https://api.scrapecreators.com';
const HEADER_KEY = 'x-api-key';
const DEFAULT_REGION = 'BR';

function apiKey() {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    throw new Error(
      'SCRAPECREATORS_API_KEY não definida. Crie .env com SCRAPECREATORS_API_KEY=...'
    );
  }
  return key;
}

async function call(path, query = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const started = Date.now();
  const res = await fetch(url, {
    method: 'GET',
    headers: { [HEADER_KEY]: apiKey(), Accept: 'application/json' },
  });
  const durationMs = Date.now() - started;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ScrapeCreators ${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.success === false) {
    throw new Error(`ScrapeCreators ${path} → success:false | ${JSON.stringify(json).slice(0, 300)}`);
  }

  return {
    ...json,
    _meta: {
      path,
      query,
      durationMs,
      creditsCharged: json.credits_charged,
      creditsRemaining: json.credits_remaining,
    },
  };
}

/** Busca produtos por keyword em uma região (BR por padrão). */
export function shopSearch(query, { region = DEFAULT_REGION, page } = {}) {
  return call('/v1/tiktok/shop/search', { query, region, page });
}

/** Lista produtos de uma LOJA específica (precisa URL da loja). */
export function shopProducts(storeUrl, { region = DEFAULT_REGION, sort_by, cursor } = {}) {
  return call('/v1/tiktok/shop/products', { url: storeUrl, region, sort_by, cursor });
}

/** Detalhes de UM produto (aceita URL de PDP). Inclui related_videos com creators afiliados. */
export function product(pdpUrl, { region = DEFAULT_REGION } = {}) {
  return call('/v1/tiktok/product', { url: pdpUrl, region });
}

/** Vídeos por hashtag (não é Shop-específico — vídeos gerais). */
export function searchHashtag(hashtag, { region = DEFAULT_REGION } = {}) {
  return call('/v1/tiktok/search/hashtag', { hashtag, region });
}

/**
 * Normaliza um produto do endpoint shop/search pro schema local.
 * Deixa o formato pronto pra virar snapshot no Firestore.
 */
export function normalizeSearchProduct(raw) {
  const priceInfo = raw.product_price_info || {};
  const soldInfo = raw.sold_info || {};
  const rate = raw.rate_info || {};
  const seller = raw.seller_info || {};
  const image = raw.image?.url_list?.[0] || null;

  return {
    productId: String(raw.product_id),
    title: raw.title || null,
    description: raw.product_description || null,
    image,
    pdpUrl: raw.seo_url?.canonical_url || null,
    price: {
      sale: priceInfo.sale_price_decimal ? Number(priceInfo.sale_price_decimal) : null,
      original: priceInfo.origin_price_decimal ? Number(priceInfo.origin_price_decimal) : null,
      currency: priceInfo.currency_symbol || null,
      discountPct: priceInfo.discount_format || null,
      saleFormatted: priceInfo.sale_price_format || null,
    },
    rating: rate.score ?? null,
    reviewCount: rate.review_count ?? null,
    soldCount: soldInfo.sold_count ?? null,
    seller: {
      id: seller.seller_id ? String(seller.seller_id) : null,
      name: seller.shop_name || null,
      logo: seller.shop_logo || null,
    },
    searchMeta: raw.search_meta || null,
    _source: 'scrapecreators.shop.search',
  };
}
