/**
 * Cópia de src/collectors/scrapecreators.js para dentro de functions/.
 *
 * Por quê a cópia (e não um import relativo pra ../../src/...): o deploy do
 * Firebase Cloud Functions empacota só o conteúdo de functions/ — qualquer
 * import que aponte pra fora dessa pasta funciona no emulador (que roda
 * direto no disco local) mas quebra em produção (o zip enviado pro Cloud
 * Build não inclui ../src). Ver README.md em functions/.
 *
 * Cliente ScrapeCreators — TikTok Shop.
 * Chave: env/secret SCRAPECREATORS_API_KEY.
 */
const BASE = 'https://api.scrapecreators.com';
const HEADER_KEY = 'x-api-key';
const DEFAULT_REGION = 'BR';

function apiKey() {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    throw new Error('SCRAPECREATORS_API_KEY não definida (functions:secrets:set).');
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

/** Busca vídeos por hashtag (retorna aweme_list — vídeos gerais, com ou sem produto). */
export function searchHashtag(hashtag, { region = DEFAULT_REGION } = {}) {
  return call('/v1/tiktok/search/hashtag', { hashtag, region });
}

/**
 * O endpoint shop/search devolve os preços em CENTAVOS como string
 * (ex: "1725" = R$17,25) — ver src/collectors/scrapecreators.js pra a
 * explicação completa de como isso foi confirmado.
 */
function centsToReais(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null;
}

function formatBRL(n) {
  if (n == null) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Normaliza um produto do endpoint shop/search pro schema local.
 */
export function normalizeSearchProduct(raw) {
  const priceInfo = raw.product_price_info || {};
  const soldInfo = raw.sold_info || {};
  const rate = raw.rate_info || {};
  const seller = raw.seller_info || {};
  const image = raw.image?.url_list?.[0] || null;

  const salePrice = centsToReais(priceInfo.sale_price_decimal);
  const originalPrice = centsToReais(priceInfo.origin_price_decimal);

  return {
    productId: String(raw.product_id),
    title: raw.title || null,
    description: raw.product_description || null,
    image,
    pdpUrl: raw.seo_url?.canonical_url || null,
    // category_breadcrumb vem preenchido em ~20-25% dos produtos (confirmado
    // ao vivo contra a API) — formato [{category_id, category_name, level}].
    category: raw.category_breadcrumb || null,
    price: {
      sale: salePrice,
      original: originalPrice,
      currency: priceInfo.currency_symbol || null,
      discountPct: priceInfo.discount_format || null,
      saleFormatted: formatBRL(salePrice),
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
