import { extractHydrationData, deepFind, deepFindAll } from './hydration.js';
import { normalizeProductFromPartial } from './product-parser.js';

function parseBrNumber(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

/** Rating 0–5: ponto é decimal (4.6), não separador de milhar */
function parseRating(text) {
  if (text == null || text === '') return null;
  const num = parseFloat(String(text).trim().replace(',', '.'));
  if (Number.isNaN(num) || num < 0 || num > 5) return null;
  return num;
}

function parseCompactCount(text) {
  if (!text) return null;
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

function extractJsonBlobsFromHtml(html, productId) {
  const results = [];
  const patterns = [
    new RegExp(`\\{[\\s\\S]{0,8000}?"product_id"\\s*:\\s*"${productId}"[\\s\\S]{0,8000}?\\}`, 'g'),
    new RegExp(`\\{[\\s\\S]{0,8000}?"productId"\\s*:\\s*"${productId}"[\\s\\S]{0,8000}?\\}`, 'g'),
    /\{[\s\S]{0,12000}?"sold_count"[\s\S]{0,12000}?\}/g,
    /\{[\s\S]{0,12000}?"soldCount"[\s\S]{0,12000}?\}/g,
  ];

  for (const pattern of patterns) {
    const matches = html.match(pattern) || [];
    for (const match of matches) {
      try {
        results.push(JSON.parse(match));
      } catch {
        // ignore invalid json chunks
      }
    }
  }

  return results;
}

function isProductLike(obj, productId) {
  if (!obj || typeof obj !== 'object') return false;
  const id = String(obj.product_id || obj.productId || obj.id || '');
  if (id === productId) return true;
  return Boolean(
    (obj.title || obj.product_name || obj.name) &&
    (obj.sold_count != null || obj.soldCount != null || obj.price != null || obj.sale_price != null)
  );
}

/**
 * Extrai produto escaneando scripts e JSON embutido no HTML.
 */
export function extractProductFromHtml(html, productId) {
  const hydration = extractHydrationData(html);
  if (hydration) {
    const matches = deepFindAll(hydration.data, (node) => isProductLike(node, productId));
    for (const raw of matches) {
      if (String(raw.product_id || raw.productId || raw.id) === productId || raw.title) {
        return normalizeProductFromPartial(raw, productId);
      }
    }
  }

  const blobs = extractJsonBlobsFromHtml(html, productId);
  for (const blob of blobs) {
    const raw = deepFind(blob, (node) => isProductLike(node, productId));
    if (raw) return normalizeProductFromPartial(raw, productId);
  }

  return null;
}

/**
 * Extrai produto do DOM renderizado (TikTok Shop BR).
 */
export async function extractProductFromDom(page, productId) {
  // Garante que a seção de avaliações (abaixo da dobra) esteja no DOM
  await page.evaluate(() => {
    const reviewBlock = [...document.querySelectorAll('div')].find((el) =>
      /avalia/i.test(el.textContent || '')
    );
    reviewBlock?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(800);

  const dom = await page.evaluate((pid) => {
    const cleanTitle = (t) =>
      (t || '')
        .replace(/\s*[-|]\s*TikTok Shop.*$/i, '')
        .replace(/\s*[-|]\s*TikTok.*$/i, '')
        .trim();

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const h1 = document.querySelector('h1')?.textContent?.trim();
    const title = cleanTitle(h1 || ogTitle || document.title);

    const bodyText = document.body?.innerText || '';

    const priceMatch =
      bodyText.match(/R\$\s*([\d.,]+)/) ||
      bodyText.match(/(?:por|de)\s*R\$\s*([\d.,]+)/i);
    const originalMatch = bodyText.match(/R\$\s*([\d.,]+)[\s\S]{0,40}R\$\s*([\d.,]+)/);

    const soldMatch =
      bodyText.match(/([\d.,]+[kKmM]?\+?)\s*vendid[oa]/i) ||
      bodyText.match(/([\d.,]+[kKmM]?\+?)\s*vendidos/i) ||
      bodyText.match(/([\d.,]+[kKmM]?\+?)\s*vendas/i) ||
      bodyText.match(/([\d.,]+[kKmM]?\+?)\s*sold/i);

    let ratingText = null;
    let reviewText = null;
    let soldText = soldMatch?.[1] || null;

    // Bloco do topo: 4.6 ★ (1.9K) | 10.0K vendido(s)
    const statsRow = [...document.querySelectorAll('.flex.flex-row.items-center.mt-12')].find((el) =>
      /vendid/i.test(el.textContent || '')
    );
    if (statsRow) {
      const ratingSpan = statsRow.querySelector('span.H2-Semibold');
      const candidate = ratingSpan?.textContent?.trim();
      if (candidate && /^\d([.,]\d)?$/.test(candidate.replace(',', '.'))) {
        ratingText = candidate;
      }

      for (const span of statsRow.querySelectorAll('span.H3-Regular')) {
        const txt = span.textContent?.trim() || '';
        const paren = txt.match(/^\(([\d.,]+[kKmM]?)\)$/i);
        if (paren) reviewText = paren[1];
        const sold = txt.match(/([\d.,]+[kKmM]?)\s*vendid[oa]/i);
        if (sold) soldText = sold[1];
      }
    }

    // Seção de avaliações expandida: H1-Bold 4.6 + "1888 avaliações globais"
    if (!ratingText) {
      const ratingHeader = [...document.querySelectorAll('.flex.items-center.gap-8')].find(
        (el) => el.querySelector('.H1-Bold') && el.querySelector('svg')
      );
      if (ratingHeader) {
        const candidate = ratingHeader.querySelector('.H1-Bold')?.textContent?.trim();
        if (candidate && /^\d([.,]\d)?$/.test(candidate.replace(',', '.'))) {
          ratingText = candidate;
        }
      }
    }
    if (!ratingText) {
      const h1Bold = document.querySelector('.H1-Bold.text-color-UIText1Display');
      const candidate = h1Bold?.textContent?.trim();
      if (candidate && /^\d([.,]\d)?$/.test(candidate.replace(',', '.'))) {
        ratingText = candidate;
      }
    }

    if (!reviewText) {
      const reviewEl =
        document.querySelector('.H2-Semibold') ||
        [...document.querySelectorAll('[class*="Semibold"]')].find((el) =>
          /avalia/i.test(el.textContent || '')
        );
      const reviewFromDom = reviewEl?.textContent?.match(/([\d.,]+[kKmM]?\+?)\s*avalia/i);
      if (reviewFromDom) reviewText = reviewFromDom[1];
    }

    if (!ratingText || !reviewText) {
      const ratingMatch =
        bodyText.match(/([\d,.]+)\s*(?:\/\s*5|estrelas|stars)/i) ||
        bodyText.match(/([\d,.]+)\s*de\s*5/i);
      const reviewMatch = bodyText.match(/([\d.,]+[kKmM]?\+?)\s*(?:avalia|review|coment)/i);
      ratingText = ratingText || ratingMatch?.[1] || null;
      reviewText = reviewText || reviewMatch?.[1] || null;
    }

    // Distribuição 5★→1★ (barras com contagem à direita)
    const ratingDistribution = {};
    const distContainer = document.querySelector('.flex.flex-col.gap-12');
    if (distContainer) {
      for (const row of distContainer.querySelectorAll('.flex.items-center.gap-12')) {
        const star = row.querySelector('.H3-Bold')?.textContent?.trim();
        const count = row.querySelector('.H3-Regular')?.textContent?.trim();
        if (star && /^[1-5]$/.test(star) && count) {
          ratingDistribution[star] = parseInt(count.replace(/\./g, ''), 10);
        }
      }
    }

    const images = [...document.querySelectorAll('img')]
      .map((img) => img.src)
      .filter((src) => src && (src.includes('tiktok') || src.includes('byteimg')))
      .slice(0, 8);

    // Varre scripts por JSON com productId
    let scriptRaw = null;
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (!text.includes(pid) && !text.includes('sold') && !text.includes('price')) continue;
      if (text.includes('"product_id"') || text.includes('"productId"') || text.includes('"sold_count"')) {
        scriptRaw = text.slice(0, 50000);
        break;
      }
    }

    return {
      title,
      priceText: priceMatch?.[1] || null,
      originalPriceText: originalMatch?.[1] || null,
      soldText: soldMatch?.[1] || null,
      ratingText,
      reviewText,
      ratingDistribution:
        Object.keys(ratingDistribution).length > 0 ? ratingDistribution : null,
      images,
      scriptRaw,
      url: location.href,
    };
  }, productId);

  if (!dom.title || dom.title.length < 3) return null;

  const domPartial = {
    product_id: productId,
    title: dom.title,
    price: parseBrNumber(dom.priceText),
    original_price: parseBrNumber(dom.originalPriceText),
    sold_count: parseCompactCount(dom.soldText),
    rating: parseRating(dom.ratingText),
    review_count: parseCompactCount(dom.reviewText),
    rating_distribution: dom.ratingDistribution,
    images: dom.images,
  };

  if (dom.scriptRaw) {
    const fromScript = extractProductFromHtml(`<script>${dom.scriptRaw}</script>`, productId);
    if (fromScript) {
      return normalizeProductFromPartial(
        {
          ...fromScript,
          ...Object.fromEntries(
            Object.entries(domPartial).filter(([, v]) => v != null && v !== '' && v !== 0)
          ),
          product_id: productId,
          title: domPartial.title || fromScript.title,
        },
        productId,
        dom.url
      );
    }
  }

  return normalizeProductFromPartial(domPartial, productId, dom.url);
}
