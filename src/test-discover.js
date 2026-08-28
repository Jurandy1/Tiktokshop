#!/usr/bin/env node

/**
 * Descobre produtos populares no TikTok Shop.
 *
 * Uso:
 *   node src/test-discover.js --cdp
 *   node src/test-discover.js --cdp --source search --query macacão
 *   node src/test-discover.js --cdp --limit 20 --enrich 5
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  discoverPopularProducts,
  DISCOVERY_SOURCES,
  shopDiscoveryUrl,
} from './collectors/shop-discovery-collector.js';
import { collectProductsViaCdp } from './collectors/cdp-collector.js';
import { config } from './config.js';
import { isFirebaseConfigured, saveProductsToFirebase } from './db/firebase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../output');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function formatSold(value) {
  if (value == null) return '?';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const source = flags.source || 'trending';
  const query = flags.query || null;
  const limit = Number(flags.limit) || 30;
  const enrichCount = flags.enrich ? Number(flags.enrich) : 0;
  const useCdp = flags['no-cdp'] ? false : true;
  const visible = Boolean(flags.visible);
  const saveFirebase = Boolean(flags.firebase);

  const targetUrl = shopDiscoveryUrl(source, { query, region: config.region });

  console.log('\n🔥 Descoberta de produtos populares — TikTok Shop');
  console.log(`   Fonte: ${source} — ${DISCOVERY_SOURCES[source] || source}`);
  if (query) console.log(`   Busca: "${query}"`);
  console.log(`   URL: ${targetUrl}`);
  console.log(`   Limite: ${limit} produtos`);
  console.log(`   Modo CDP: ${useCdp ? 'sim (Chrome seu)' : 'não'}`);
  if (enrichCount > 0) console.log(`   Enriquecer top ${enrichCount} com dados completos (PDP)`);

  if (useCdp) {
    console.log('\n   ℹ️  Modo CDP:');
    console.log('   1. Rode: scripts\\abrir-chrome-debug.cmd');
    console.log('   2. Abra https://www.tiktok.com/shop?region=br no Chrome');
    console.log('   3. Role a página para carregar produtos');
    console.log('   4. Rode este comando\n');
  }

  console.log('   ⏳ Descobrindo produtos...\n');

  const discovery = await discoverPopularProducts({
    source,
    query,
    limit,
    cdp: useCdp,
    visible,
    fallbackBrowser: !useCdp,
    forceNavigate: Boolean(flags.navigate),
  });

  let enriched = [];

  if (enrichCount > 0 && discovery.products.length > 0 && useCdp) {
    console.log(`\n   📦 Enriquecendo top ${enrichCount} produto(s)...\n`);
    const top = discovery.products.slice(0, enrichCount);
    const detailResults = await collectProductsViaCdp(top, { delayMs: 2500 });

    enriched = top.map((item, index) => {
      const detail = detailResults[index];
      if (detail?.success && detail.product) {
        return { ...item, ...detail.product, enriched: true, detailSource: detail.source };
      }
      return { ...item, enriched: false, enrichError: detail?.error || 'Falha ao enriquecer' };
    });
  }

  const result = {
    collectedAt: new Date().toISOString(),
    discovery,
    products: discovery.products,
    enrichedProducts: enriched.length > 0 ? enriched : undefined,
    summary: {
      discovered: discovery.products.length,
      enriched: enriched.filter((p) => p.enriched).length,
      source,
      query,
      success: discovery.success,
    },
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = join(OUTPUT_DIR, `discover-${source}-${Date.now()}.json`);
  await writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`\n📄 Resultado: ${filepath}`);
  console.log(`   Encontrados: ${discovery.products.length} produto(s)\n`);

  if (discovery.products.length === 0) {
    console.log(`   ❌ ${discovery.error || 'Nenhum produto encontrado'}`);
    if (discovery.pageTitle) console.log(`   Página: ${discovery.pageTitle}`);
    process.exit(1);
  }

  discovery.products.forEach((product, index) => {
    const title = product.title?.slice(0, 55) || product.productId;
    const price = product.price != null ? `R$ ${product.price}` : 'R$ ?';
    const sold = formatSold(product.soldCount);
    const rating =
      product.rating != null
        ? `${product.rating}${product.ratingCount ? ` (${product.ratingCount})` : ''}`
        : product.ratingCount
          ? `? (${product.ratingCount})`
          : '?';
    console.log(`   ${String(index + 1).padStart(2, ' ')}. ${title}`);
    console.log(`       ID: ${product.productId} | ${price} | ${sold} vendidos | ★ ${rating}`);
  });

  const withStats = discovery.products.filter((p) => p.price != null || p.soldCount != null).length;
  if (withStats === 0 && enrichCount === 0) {
    console.log(`\n   ℹ️  Lista sem preço/vendidos na home — use --enrich 10 para dados completos:`);
    console.log(`   node src/test-discover.js --cdp --source ${source}${query ? ` --query "${query}"` : ''} --enrich 10`);
  } else if (withStats > 0) {
    console.log(`\n   📊 ${withStats}/${discovery.products.length} com preço ou vendidos na listagem`);
  }

  if (saveFirebase && enriched.length > 0 && isFirebaseConfigured()) {
    const toSave = enriched.filter((p) => p.enriched);
    if (toSave.length > 0) {
      const saved = await saveProductsToFirebase(toSave, { source: `discover-${source}` });
      console.log(`\n🔥 Firebase: ${saved.savedIds.length} produto(s) em "${saved.collection}"`);
    }
  }

  console.log(`\n💡 Para detalhes completos de um produto:`);
  console.log(`   node src/test-shop.js --ids ${discovery.products[0].productId} --cdp`);
  console.log(`\n💡 Para enriquecer os top 10 automaticamente:`);
  console.log(`   node src/test-discover.js --cdp --source ${source}${query ? ` --query "${query}"` : ''} --enrich 10`);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
