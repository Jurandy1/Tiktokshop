/**
 * Núcleo da pipeline v2 (ScrapeCreators → Firestore), extraído de sync-viral-v2.js
 * pra ser reaproveitado tanto pelo CLI local quanto pelas Cloud Functions
 * (functions/src/scheduled-sync.js, functions/src/on-scrape-request.js).
 *
 * Não precisa browser. Não precisa Chrome debug. Roda em qualquer lugar.
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shopSearch, normalizeSearchProduct } from './collectors/scrapecreators.js';
import { enrichProductsFromCdp } from './collectors/tiktok-shop-browser-proxy.js';
import { isFirebaseConfigured, upsertProductWithSnapshot, saveRun } from './db/firebase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../output');

export const DEFAULT_QUERIES = ['achadinhos', 'tiktokshop'];

function fmt(n) {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Viral score simples: soldCount * rating.
 * (rating null → 4.0 padrão; sold null → 0 penaliza)
 */
export function computeViralScore(p) {
  const sold = Number(p.soldCount) || 0;
  const rating = Number(p.rating) || 4.0;
  return Math.round(sold * rating);
}

/**
 * Roda a pipeline completa: busca (ScrapeCreators) → consolida → (opcional) enriquece via CDP
 * → (opcional) grava no Firestore → (opcional) salva JSON local.
 *
 * Options:
 *   queries        string[]  — palavras-chave de busca (default: DEFAULT_QUERIES)
 *   minSold        number    — filtro mínimo de soldCount (default: 0)
 *   region         string    — região ScrapeCreators (default: 'BR')
 *   save           boolean   — grava no Firestore (default: false)
 *   enrich         number    — quantos produtos enriquecer via CDP local (default: 0; NÃO
 *                               funciona em Cloud Functions — deixe 0 em ambiente serverless)
 *   runId          string    — id da run (default: gerado)
 *   source         string    — rótulo da origem da run, pra distinguir no dashboard
 *                               (ex: 'scheduled', 'scrape_request', 'cli')
 *   writeLocalJson boolean   — grava snapshot em output/*.json (default: true; local dev)
 *   log            function  — logger (default: console.log); passe () => {} pra silenciar
 */
export async function runSync(options = {}) {
  const {
    queries = DEFAULT_QUERIES,
    minSold = 0,
    region = 'BR',
    save = false,
    enrich = 0,
    runId = `run-v2-${Date.now()}`,
    source = 'cli',
    writeLocalJson = true,
    log = (...args) => console.log(...args),
  } = options;

  log(`\n🔥 sync-viral-v2  runId=${runId}  source=${source}`);
  log(`   Queries: ${queries.join(', ')}  |  region=${region}  |  min-sold=${minSold}`);
  log(`   Salvar Firebase: ${save ? (isFirebaseConfigured() ? 'sim' : 'PEDIDO mas não configurado') : 'não'}`);
  log();

  const startedAt = new Date().toISOString();
  const perQuery = [];
  const all = new Map(); // dedup por productId
  let creditsRemaining = null;

  for (const query of queries) {
    log(`   🔎 shopSearch(${query}, ${region}) ...`);
    let res;
    try {
      res = await shopSearch(query, { region });
    } catch (err) {
      log(`      ❌ ${err.message}`);
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
    log(`      → ${rows.length} produto(s) | créditos: ${creditsRemaining}`);
    perQuery.push({ query, count: rows.length });
  }

  const products = [...all.values()]
    .filter((p) => (p.soldCount ?? 0) >= minSold)
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

  log(`\n📊 Consolidado: ${products.length} produto(s) únicos (após min-sold=${minSold})\n`);

  // Enriquecimento opcional via browser-proxy (requer Chrome debug 9222 — SÓ LOCAL)
  const enrichCount = Number(enrich || 0);
  if (enrichCount > 0 && products.length > 0) {
    const targets = products.slice(0, enrichCount);
    log(`\n🔬 Enriquecendo top ${targets.length} via CDP browser-proxy (reviews + more_from)...`);
    try {
      const enriched = await enrichProductsFromCdp(
        targets.map((p) => p.productId),
        { delayMs: 2500 }
      );
      const byId = new Map(enriched.map((e) => [e.productId, e]));
      products.forEach((p) => {
        const e = byId.get(p.productId);
        if (!e || !e.success) return;
        p.rating = e.reviews.overallScore ?? p.rating;
        p.reviewCount = e.reviews.reviewCount || p.reviewCount;
        p.ratingDistribution = e.reviews.ratingDistribution;
        p.sellerId = e.pageData.sellerId || p.seller?.id;
        p.categories = e.pageData.categories;
        p.moreFromSameShop = e.pageData.moreFrom.length;
        p.viralScore = computeViralScore(p);
      });
      log(`   ✅ enriquecidos: ${enriched.filter((e) => e.success).length}/${targets.length}`);
    } catch (err) {
      log(`   ⚠  Falhou enriquecer via CDP: ${err.message}`);
      log(`      (o Chrome debug tá aberto? scripts\\abrir-chrome-debug.cmd tiktokshop)`);
    }
    products.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
  }

  products.slice(0, 15).forEach((p, i) => {
    const currency = p.price.currency || '';
    const price = p.price.saleFormatted ? `${currency}${p.price.saleFormatted}` : '?';
    log(
      `   ${String(i + 1).padStart(2, '0')} score=${fmt(p.viralScore).padStart(6)} • ${fmt(p.soldCount).padStart(6)} vendidos • ${price.padStart(10)} • ${(p.title || '').slice(0, 55)}`
    );
  });

  if (writeLocalJson) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const stamp = Date.now();
    const payload = {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      region,
      queries,
      perQuery,
      creditsRemaining,
      filters: { minSold },
      totalUnique: products.length,
      products,
    };
    const filepath = join(OUTPUT_DIR, `viral-v2-${stamp}.json`);
    const latestPath = join(OUTPUT_DIR, `viral-v2-latest.json`);
    await writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');
    await writeFile(latestPath, JSON.stringify(payload, null, 2), 'utf-8');
    log(`\n📄 JSON salvo: ${filepath}`);
  }

  let saved = 0;
  const errors = [];

  if (save) {
    if (!isFirebaseConfigured()) {
      log('\n⚠  Firebase pedido mas não configurado (serviceAccountKey.json / credenciais do runtime)');
      return { runId, products, saved, errors, ok: false, reason: 'firebase-not-configured' };
    }
    log(`\n🔥 Salvando ${products.length} produto(s) no Firestore ...`);
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
      productsFound: products.length,
      productsSaved: saved,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    log(`   ✅ ${saved} salvo(s) | ${errors.length} erro(s) | runId=${runId}`);
    if (errors.length) errors.slice(0, 5).forEach((e) => log(`     • ${e.productId}: ${e.error}`));
  } else {
    log(`\n   💡 Pra gravar no Firebase, passe save: true`);
  }

  return { runId, products, saved, errors, ok: true };
}
