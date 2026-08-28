/**
 * Browser Proxy: reusa Chrome debug (9222), navega numa PDP e INTERCEPTA
 * as chamadas que o próprio site faz — sem replicar payload nem token.
 *
 * O browser gera `X-Tts-Oec-Bsid` sozinho (via webmssdk.js) e monta os payloads
 * corretos com `seller_id`. A gente só espera as respostas chegarem.
 *
 * Endpoints interceptados hoje (todos funcionam em BR):
 *   - POST /api/shop/pdp_desktop/page_data          → more_from + you_may_like
 *   - POST /api/shop/pdp_desktop/get_product_reviews → reviews + rating agregado
 *
 * Bloqueado em BR (workaround via ScrapeCreators shopSearch):
 *   - global_api_data.nova_config → detalhes do produto principal
 */
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const NAV_TIMEOUT_MS = 90_000;
const CAPTURE_TIMEOUT_MS = 20_000;

async function connectCdp() {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (!contexts.length) {
    await browser.close();
    throw new Error(
      `Chrome debug sem contexto. Abra: scripts\\abrir-chrome-debug.cmd tiktokshop`
    );
  }
  const context = contexts[0];
  const page =
    context.pages().find((p) => !p.isClosed() && p.url().includes('shop.tiktok.com')) ||
    context.pages().find((p) => !p.isClosed()) ||
    (await context.newPage());
  return { browser, context, page };
}

/**
 * Navega numa PDP e captura page_data + get_product_reviews que o site
 * naturalmente dispara. Retorna o que interceptou.
 */
export async function collectPdp(productId, options = {}) {
  const url = `https://shop.tiktok.com/br/pdp/${productId}`;
  const { browser, page } = await connectCdp();

  const captured = { pageData: null, reviews: null, others: [] };

  const handler = async (res) => {
    const u = res.url();
    if (res.status() !== 200) return;
    if (u.includes('/api/shop/pdp_desktop/page_data')) {
      try { captured.pageData = await res.json(); } catch {}
    } else if (u.includes('/api/shop/pdp_desktop/get_product_reviews')) {
      try { captured.reviews = await res.json(); } catch {}
    } else if (options.debug && u.includes('/api/shop')) {
      try { captured.others.push({ url: u, body: await res.json() }); } catch {}
    }
  };
  page.on('response', handler);

  try {
    // Se já está na PDP certa, força reload leve pra disparar as XHRs
    if (page.url().includes(`/pdp/${productId}`)) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    }

    // Aguarda até 20s ou ambos terem chegado
    const start = Date.now();
    while (Date.now() - start < CAPTURE_TIMEOUT_MS) {
      if (captured.pageData) break;
      await page.waitForTimeout(500);
    }
    // Rola até o rodapé pra disparar reviews (lazy on viewport)
    for (let i = 0; i < 15 && !captured.reviews; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.7));
      await page.waitForTimeout(1200);
    }

    // Fallback: se reviews ainda não vieram, chama manualmente (schema conhecido)
    if (!captured.reviews) {
      try {
        const manual = await page.evaluate(async (pid) => {
          const res = await fetch('/api/shop/pdp_desktop/get_product_reviews', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              product_id: pid,
              sort_rule: 1,
              page_start: 1,
              page_size: 20,
              review_filter: { filter_type: 0, filter_value: 0 },
              component_name: 'reviews',
            }),
            credentials: 'include',
          });
          if (res.status !== 200) return null;
          return await res.json();
        }, productId);
        if (manual?.code === 0) captured.reviews = manual;
      } catch { /* ignore */ }
    }
  } finally {
    page.off('response', handler);
    await browser.close();
  }

  // Parse dos resultados
  const pd = captured.pageData?.data;
  const rv = captured.reviews?.data;

  const components = pd?.components_map || [];
  const moreFrom =
    components.find((c) => c.component_name === 'feed_list_more_from')?.component_data?.products || [];
  const youMayLike =
    components.find((c) => c.component_name === 'feed_list_you_may_like')?.component_data?.products || [];

  return {
    productId,
    success: Boolean(pd || rv),
    pageData: {
      captured: Boolean(pd),
      moreFrom,
      youMayLike,
      sellerId: pd?.global_data?.product_info?.product_info?.product_model?.seller_id || null,
      categories: pd?.global_data?.product_info?.categories || [],
      novaRegionSupported: pd?.global_api_data?.nova_config?.base_resp?.StatusCode === 0,
    },
    reviews: {
      captured: Boolean(rv),
      totalReviews: Number(rv?.total_reviews) || 0,
      overallScore: rv?.review_ratings?.overall_score ?? null,
      ratingDistribution: rv?.review_ratings?.rating_result || null,
      reviewCount: Number(rv?.review_ratings?.review_count) || 0,
      samples: (rv?.product_reviews || []).slice(0, 3).map((r) => ({
        rating: r.review_rating,
        text: r.review_text?.slice(0, 120),
        country: r.review_country,
      })),
    },
    otherApiCalls: captured.others,
  };
}

/** Enriquece N produtos em série via CDP. */
export async function enrichProductsFromCdp(productIds, options = {}) {
  const results = [];
  for (const productId of productIds) {
    try {
      const r = await collectPdp(productId, options);
      results.push(r);
    } catch (err) {
      results.push({ productId, success: false, error: err.message });
    }
    if (options.delayMs) await new Promise((res) => setTimeout(res, options.delayMs));
  }
  return results;
}
