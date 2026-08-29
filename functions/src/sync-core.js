/**
 * Núcleo da coleta de produtos (ScrapeCreators → Firestore), adaptado de
 * src/sync-viral-v2-core.js pra rodar dentro de Cloud Functions: sem
 * enriquecimento via CDP (precisa de Chrome local, nunca disponível aqui) e
 * sem gravar JSON local (filesystem da function é efêmero).
 */
import { shopSearch, normalizeSearchProduct } from './scrapecreators.js';
import { upsertProductWithSnapshot, saveRun } from './firebase.js';

export const DEFAULT_QUERIES = ['achadinhos', 'tiktokshop'];

/** Viral score simples: soldCount * rating (rating null → 4.0 padrão). */
export function computeViralScore(p) {
  const sold = Number(p.soldCount) || 0;
  const rating = Number(p.rating) || 4.0;
  return Math.round(sold * rating);
}

/**
 * Busca produtos via ScrapeCreators e grava no Firestore.
 *
 * Options: queries (string[]), minSold (number), region (string),
 *          runId (string), source (string — rótulo pro dashboard distinguir
 *          run agendada de run sob-demanda).
 */
export async function runSync({
  queries = DEFAULT_QUERIES,
  minSold = 0,
  region = 'BR',
  runId = `run-v2-${Date.now()}`,
  source = 'scheduled',
} = {}) {
  const startedAt = new Date().toISOString();
  const perQuery = [];
  const all = new Map();
  let creditsRemaining = null;

  for (const query of queries) {
    let res;
    try {
      res = await shopSearch(query, { region });
    } catch (err) {
      console.error(`shopSearch(${query}) falhou: ${err.message}`);
      perQuery.push({ query, error: err.message });
      continue;
    }
    creditsRemaining = res._meta.creditsRemaining;
    const rows = (res.products || []).map(normalizeSearchProduct);
    rows.forEach((p) => {
      p.viralScore = computeViralScore(p);
      p.discoveredVia = query;
      const existing = all.get(p.productId);
      if (!existing || (p.soldCount || 0) > (existing.soldCount || 0)) {
        all.set(p.productId, p);
      }
    });
    perQuery.push({ query, count: rows.length });
  }

  const products = [...all.values()]
    .filter((p) => (p.soldCount ?? 0) >= minSold)
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

  let saved = 0;
  const errors = [];
  for (const p of products) {
    try {
      await upsertProductWithSnapshot(p, { runId });
      saved++;
    } catch (err) {
      errors.push({ productId: p.productId, error: err.message });
    }
  }

  await saveRun({
    runId,
    source,
    region,
    queries,
    perQuery,
    creditsRemaining,
    productsFound: products.length,
    productsSaved: saved,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  console.log(
    `runSync ${runId}: ${products.length} produto(s) encontrados, ${saved} salvos, ${errors.length} erro(s)`
  );

  return { runId, productsFound: products.length, saved, errors, ok: errors.length === 0 };
}
