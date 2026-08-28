/**
 * Coleta DIRETA de PDP do TikTok Shop BR sem abrir browser.
 *
 * Estratégia: reusar msToken/ttwid da sessão anônima (já feita pelo Playwright)
 * e bater direto no endpoint web `pdp_desktop/product_info`. Muito mais rápido
 * e barato que rodar browser inteiro por produto.
 *
 * Se o endpoint responder captcha/403, o caller deve cair para o coletor CDP.
 *
 * Base: análise do gist adrianhorning08 + captura própria via
 *       scripts/auto-mapear-endpoints.js (rode ele pra descobrir os paths
 *       exatos e ajustar CANDIDATE_ENDPOINTS abaixo).
 */
import { getOrRefreshAnonymousSession, buildCookieHeader } from '../session/anonymous-session.js';
import { config, extractProductId } from '../config.js';
import { DESKTOP_USER_AGENT } from '../browser/stealth-context.js';

// Endpoints candidatos — ordenados por probabilidade de sucesso.
// Ajuste depois do primeiro auto-mapear.
const CANDIDATE_ENDPOINTS = [
  {
    name: 'pdp_desktop_product_info',
    build: (productId, msToken) =>
      `https://www.tiktok.com/api/shop/pdp_desktop/product_info/?product_id=${productId}` +
      `&region=${config.region.toUpperCase()}&aid=1988` +
      (msToken ? `&msToken=${encodeURIComponent(msToken)}` : ''),
  },
  {
    name: 'product_detail',
    build: (productId, msToken) =>
      `https://www.tiktok.com/api/shop/product/detail/?product_id=${productId}` +
      `&region=${config.region.toUpperCase()}&aid=1988` +
      (msToken ? `&msToken=${encodeURIComponent(msToken)}` : ''),
  },
];

function buildHeaders(cookieHeader) {
  return {
    'User-Agent': DESKTOP_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: `https://www.tiktok.com/shop/`,
    Origin: 'https://www.tiktok.com',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

function looksLikeCaptcha(body) {
  if (!body) return true;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return /captcha|verify_center|security_check|verify.tiktok/i.test(text);
}

function normalizeProduct(raw, productId) {
  const data = raw?.data || raw?.result || raw;
  if (!data || typeof data !== 'object') return null;

  const product = data.product || data.productInfo || data.product_info || data;
  const priceInfo = product.product_price_info || product.priceInfo || product.price_info || {};
  const soldInfo = product.sold_info || product.soldInfo || {};
  const rate = product.rate_info || product.rateInfo || {};

  return {
    productId: String(product.product_id || product.productId || productId),
    title: product.title || product.product_name || null,
    description: product.product_description || product.description || null,
    images:
      product.images?.map?.((img) => (img.url_list ? img.url_list[0] : img)) ||
      product.image?.url_list ||
      [],
    price: {
      sale: priceInfo.sale_price_decimal ? Number(priceInfo.sale_price_decimal) : null,
      original: priceInfo.origin_price_decimal ? Number(priceInfo.origin_price_decimal) : null,
      currency: priceInfo.currency_symbol || null,
      saleFormatted: priceInfo.sale_price_format || null,
      discountPct: priceInfo.discount_format || null,
    },
    soldCount: soldInfo.sold_count ?? null,
    rating: rate.score ?? null,
    reviewCount: rate.review_count ?? null,
    seller: product.seller_info || product.sellerInfo || null,
    raw: product,
    _source: 'tiktok-shop-direct',
  };
}

/**
 * Tenta puxar detalhes de UM produto direto pela API web. Não abre browser.
 * @returns {Promise<{success:boolean, product?:object, endpoint?:string, error?:string, needBrowser?:boolean}>}
 */
export async function fetchProductDirect(inputId, options = {}) {
  const productId = extractProductId(inputId);
  const session = await getOrRefreshAnonymousSession({ forceRefresh: false });
  const msToken = session.keyCookies?.msToken;
  const cookieHeader = buildCookieHeader(session.storageState);

  if (!msToken) {
    return { success: false, error: 'sem msToken na sessão anônima', needBrowser: true };
  }

  const tried = [];
  for (const ep of CANDIDATE_ENDPOINTS) {
    const url = ep.build(productId, msToken);
    tried.push(ep.name);
    try {
      const res = await fetch(url, { headers: buildHeaders(cookieHeader) });
      const status = res.status;
      const contentType = res.headers.get('content-type') || '';
      const bodyText = await res.text();
      let json = null;
      if (contentType.includes('json')) {
        try { json = JSON.parse(bodyText); } catch { /* ignore */ }
      }

      if (options.debug) {
        console.log(`[direct] ${ep.name} → ${status} (${bodyText.length}B) ${contentType}`);
      }

      if (status !== 200 || !json) continue;
      if (looksLikeCaptcha(json)) return { success: false, error: 'captcha', needBrowser: true };

      const product = normalizeProduct(json, productId);
      if (product && product.title) {
        return { success: true, product, endpoint: ep.name, raw: json };
      }
    } catch (err) {
      if (options.debug) console.log(`[direct] ${ep.name} → ERR: ${err.message}`);
    }
  }

  return {
    success: false,
    error: `nenhum endpoint direto respondeu (tentou: ${tried.join(', ')})`,
    needBrowser: true,
  };
}

/** Bate em vários productIds em série (respeitando REQUEST_DELAY_MS). */
export async function fetchProductsDirect(inputIds, options = {}) {
  const delayMs = options.delayMs ?? config.requestDelayMs;
  const results = [];
  for (const id of inputIds) {
    const r = await fetchProductDirect(id, options);
    results.push({ productId: extractProductId(id), ...r });
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
  }
  return results;
}
