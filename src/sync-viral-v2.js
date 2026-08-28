#!/usr/bin/env node

/**
 * Nova pipeline (v2): ScrapeCreators (BR) → schema Firestore novo.
 *
 * Não precisa browser. Não precisa Chrome debug. Roda em qualquer lugar.
 *
 * Uso:
 *   node src/sync-viral-v2.js                              # queries default, sem salvar
 *   node src/sync-viral-v2.js --queries achadinhos,tiktokshop
 *   node src/sync-viral-v2.js --save                       # grava no Firestore
 *   node src/sync-viral-v2.js --queries kit --min-sold 100 --save
 *
 * Custo: 1 crédito ScrapeCreators por query.
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shopSearch, normalizeSearchProduct } from './collectors/scrapecreators.js';
import { enrichProductsFromCdp } from './collectors/tiktok-shop-browser-proxy.js';
import { isFirebaseConfigured, upsertProductWithSnapshot, saveRun } from './db/firebase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../output');

const DEFAULT_QUERIES = ['achadinhos', 'tiktokshop'];

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return flags;
}

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
function computeViralScore(p) {
  const sold = Number(p.soldCount) || 0;
  const rating = Number(p.rating) || 4.0;
  return Math.round(sold * rating);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const queries = (flags.queries || DEFAULT_QUERIES.join(','))
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean);
  const minSold = Number(flags['min-sold'] || 0);
  const shouldSave = Boolean(flags.save || flags.firebase);
  const region = (flags.region || 'BR').toUpperCase();
  const runId = `run-v2-${Date.now()}`;

  console.log(`\n🔥 sync-viral-v2  runId=${runId}`);
  console.log(`   Queries: ${queries.join(', ')}  |  region=${region}  |  min-sold=${minSold}`);
  console.log(`   Salvar Firebase: ${shouldSave ? (isFirebaseConfigured() ? 'sim' : 'PEDIDO mas não configurado') : 'não'}`);
  console.log();

  const startedAt = new Date().toISOString();
  const perQuery = [];
  const all = new Map(); // dedup por productId
  let creditsRemaining = null;

  for (const query of queries) {
    console.log(`   🔎 shopSearch(${query}, ${region}) ...`);
    let res;
    try {
      res = await shopSearch(query, { region });
    } catch (err) {
      console.log(`      ❌ ${err.message}`);
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
    console.log(`      → ${rows.length} produto(s) | créditos: ${creditsRemaining}`);
    perQuery.push({ query, count: rows.length });
  }

  const products = [...all.values()]
    .filter((p) => (p.soldCount ?? 0) >= minSold)
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

  console.log(`\n📊 Consolidado: ${products.length} produto(s) únicos (após min-sold=${minSold})\n`);

  // Enriquecimento opcional via browser-proxy (requer Chrome debug 9222)
  const enrichCount = Number(flags.enrich || 0);
  if (enrichCount > 0 && products.length > 0) {
    const targets = products.slice(0, enrichCount);
    console.log(`\n🔬 Enriquecendo top ${targets.length} via CDP browser-proxy (reviews + more_from)...`);
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
        // recalcula viralScore com rating real
        p.viralScore = computeViralScore(p);
      });
      console.log(`   ✅ enriquecidos: ${enriched.filter((e) => e.success).length}/${targets.length}`);
    } catch (err) {
      console.log(`   ⚠  Falhou enriquecer via CDP: ${err.message}`);
      console.log(`      (o Chrome debug tá aberto? scripts\\abrir-chrome-debug.cmd tiktokshop)`);
    }
    products.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
  }

  products.slice(0, 15).forEach((p, i) => {
    const currency = p.price.currency || '';
    const price = p.price.saleFormatted ? `${currency}${p.price.saleFormatted}` : '?';
    console.log(
      `   ${String(i + 1).padStart(2, '0')} score=${fmt(p.viralScore).padStart(6)} • ${fmt(p.soldCount).padStart(6)} vendidos • ${price.padStart(10)} • ${(p.title || '').slice(0, 55)}`
    );
  });

  // Snapshot local
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
  console.log(`\n📄 JSON salvo: ${filepath}`);

  // Firebase
  if (shouldSave) {
    if (!isFirebaseConfigured()) {
      console.log('\n⚠  Firebase pedido mas serviceAccountKey.json não encontrado');
      console.log(`   Ajuste FIREBASE_SERVICE_ACCOUNT_PATH no .env`);
      process.exit(2);
    }
    console.log(`\n🔥 Salvando ${products.length} produto(s) no Firestore ...`);
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
      source: 'scrapecreators.shop.search',
      region,
      queries,
      productsFound: products.length,
      productsSaved: saved,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    console.log(`   ✅ ${saved} salvo(s) | ${errors.length} erro(s) | runId=${runId}`);
    if (errors.length) errors.slice(0, 5).forEach((e) => console.log(`     • ${e.productId}: ${e.error}`));
  } else {
    console.log(`\n   💡 Pra gravar no Firebase, adicione --save`);
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
