#!/usr/bin/env node

/**
 * Fase C — vídeos virais por hashtag + productId (modo CDP).
 *
 * Uso:
 *   node src/test-videos.js --cdp
 *   node src/test-videos.js --cdp --hashtags achadinhos,produtosvirais,tiktokshop
 *   node src/test-videos.js --cdp --hashtags achadinhos --limit 50
 *   node src/test-videos.js --cdp --hashtags tiktokshop --probe --enrich 3
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectHashtagsViaCdp } from './collectors/cdp-content-collector.js';
import { getTopViralVideos } from './parsers/hashtag-parser.js';
import { config } from './config.js';
import { isFirebaseConfigured, saveProductsToFirebase } from './db/firebase.js';
import { collectProductsViaCdp } from './collectors/cdp-collector.js';

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

function formatCount(value) {
  if (value == null) return '?';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function printVideoLine(video, index) {
  const plays = formatCount(video.stats?.playCount);
  const likes = formatCount(video.stats?.diggCount);
  const product = video.productId ? `🛒 ${video.productId}` : 'sem produto';
  console.log(
    `   ${String(index).padStart(2, ' ')}. @${video.author?.uniqueId || '?'} | ${plays} views | ${likes} likes | score ${formatCount(video.viralScore)} | ${product}`
  );
  console.log(`       ${video.description?.slice(0, 70) || '(sem descrição)'}`);
  if (video.videoUrl) console.log(`       ${video.videoUrl}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const hashtags = (flags.hashtags || config.defaultHashtags.join(','))
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
  const maxVideos = Number(flags.limit || flags.max) || config.maxVideosPerHashtag;
  const displayTop = Number(flags.top || 15);
  const useCdp = flags['no-cdp'] ? false : true;
  const probeProducts = !flags['no-probe'] && useCdp;
  const enrichProducts = flags.enrich ? Number(flags.enrich) : 0;
  const saveFirebase = Boolean(flags.firebase);

  console.log('\n📹 Fase C — Vídeos virais + productId');
  console.log(`   Hashtags: ${hashtags.map((h) => `#${h}`).join(', ')}`);
  console.log(`   Limite: ${maxVideos} vídeos/hashtag`);
  console.log(`   Modo CDP: ${useCdp ? 'sim' : 'não'}`);
  console.log(`   Probe produto: ${probeProducts ? 'sim' : 'não'}`);

  if (useCdp) {
    console.log('\n   ℹ️  Modo CDP:');
    console.log('   1. Rode: scripts\\abrir-chrome-debug.cmd');
    console.log('   2. Faça login no TikTok no Chrome');
    console.log('   3. Abra uma hashtag, ex: https://www.tiktok.com/tag/achadinhos');
    console.log('   4. Role o feed para carregar vídeos');
    console.log('   5. Rode este comando\n');
  }

  console.log('   ⏳ Coletando vídeos...\n');

  const result = await collectHashtagsViaCdp(hashtags, {
    maxVideos,
    cdp: useCdp,
    probeForProduct: probeProducts,
    probeLimit: Number(flags['probe-limit'] || 20),
    scrolls: Number(flags.scrolls || 12),
  });

  const mostViralWithProduct = getTopViralVideos(result.videos, {
    top: 1,
    requireProductId: true,
  })[0] || null;

  let enrichedProducts = [];
  const uniqueProductIds = result.productIds.slice(0, enrichProducts || 0);

  if (enrichProducts > 0 && uniqueProductIds.length > 0 && useCdp) {
    console.log(`\n   🛒 Enriquecendo ${uniqueProductIds.length} produto(s) dos vídeos...\n`);
    const items = uniqueProductIds.map((productId) => ({ productId }));
    const details = await collectProductsViaCdp(items, { delayMs: 2500 });
    enrichedProducts = details.filter((d) => d.success && d.product).map((d) => d.product);
  }

  const payload = {
    collectedAt: result.collectedAt,
    ...result,
    mostViralWithProduct,
    enrichedProducts: enrichedProducts.length ? enrichedProducts : undefined,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = join(OUTPUT_DIR, `videos-${Date.now()}.json`);
  await writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`\n📄 Resultado: ${filepath}`);
  console.log(
    `   Vídeos: ${result.summary.totalVideos} | Com produto: ${result.summary.videosWithProduct} | ProductIds: ${result.summary.uniqueProductIds}\n`
  );

  if (result.summary.totalVideos === 0) {
    console.log('   ❌ Nenhum vídeo coletado — confira login e se a hashtag carregou no Chrome');
    for (const r of result.results) {
      if (r.error) console.log(`      #${r.hashtag}: ${r.error}`);
      if (r.captureStats) console.log(`      capture: ${JSON.stringify(r.captureStats)}`);
      if (r.pageTitle) console.log(`      página: ${r.pageTitle}`);
    }
    process.exit(1);
  }

  const withProduct = getTopViralVideos(result.videos, {
    top: displayTop,
    requireProductId: true,
  });
  const topGeneral = getTopViralVideos(result.videos, { top: displayTop });

  if (withProduct.length > 0) {
    console.log('   🏆 Top virais COM produto:\n');
    withProduct.forEach((video, index) => printVideoLine(video, index + 1));
  } else {
    console.log('   ⚠️  Nenhum vídeo com productId — o probe abre os vídeos de shop no Chrome.\n');
  }

  console.log('\n   📊 Top geral (todos):\n');
  topGeneral.forEach((video, index) => printVideoLine(video, index + 1));

  if (result.productIds.length > 0) {
    console.log(`\n   🛒 Product IDs únicos (${result.productIds.length}):`);
    console.log(`   ${result.productIds.slice(0, 10).join(', ')}${result.productIds.length > 10 ? '...' : ''}`);
    console.log(`\n   💡 Coletar detalhes dos produtos:`);
    console.log(`   node src/test-shop.js --ids ${result.productIds.slice(0, 3).join(',')} --cdp`);
  }

  if (saveFirebase && isFirebaseConfigured()) {
    if (enrichedProducts.length > 0) {
      const saved = await saveProductsToFirebase(enrichedProducts, { source: 'videos-discover' });
      console.log(`\n🔥 Firebase: ${saved.savedIds.length} produto(s) em "${saved.collection}"`);
    } else {
      console.log('\n⚠️  Firebase: use --enrich N --firebase para salvar produtos com detalhes');
    }
  }
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
