#!/usr/bin/env node

/**
 * Busca automaticamente o(s) vídeo(s) mais viral(is) nas hashtags configuradas.
 *
 * Uso:
 *   node src/sync-most-viral.js --cdp
 *   node src/sync-most-viral.js --cdp --require-product --enrich 1
 *   node src/sync-most-viral.js --cdp --hashtags achadinhos --top 3
 *
 * Agendamento Windows:
 *   scripts\rodar-mais-viral.cmd
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectHashtagsViaCdp } from './collectors/cdp-content-collector.js';
import { collectProductsViaCdp } from './collectors/cdp-collector.js';
import { config } from './config.js';
import { getTopViralVideos } from './parsers/hashtag-parser.js';
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

function formatCount(value) {
  if (value == null) return '?';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function printVideo(video, rank = 1) {
  const plays = formatCount(video.stats?.playCount);
  const likes = formatCount(video.stats?.diggCount);
  const product = video.productId ? `🛒 ${video.productId}` : 'sem produto';
  console.log(`\n   🏆 #${rank} — score ${formatCount(video.viralScore)}`);
  console.log(`      @${video.author?.uniqueId || '?'} | ${plays} views | ${likes} likes | ${product}`);
  console.log(`      ${video.description?.slice(0, 80) || '(sem descrição)'}`);
  if (video.videoUrl) console.log(`      ${video.videoUrl}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const hashtags = (flags.hashtags || config.defaultHashtags.join(','))
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
  const maxVideos = Number(flags.limit || flags.max) || 50;
  const top = Number(flags.top || 1);
  const requireProduct = flags['no-require-product'] ? false : Boolean(flags['require-product'] ?? true);
  const minPlays = Number(flags['min-plays'] || 0);
  const enrichProducts = flags.enrich ? Number(flags.enrich) : requireProduct ? 1 : 0;
  const saveFirebase = Boolean(flags.save || flags.firebase);
  const useCdp = flags['no-cdp'] ? false : true;

  console.log('\n🔥 Busca automática — vídeo mais viral');
  console.log(`   Hashtags: ${hashtags.map((h) => `#${h}`).join(', ')}`);
  console.log(`   Top: ${top} | Limite coleta: ${maxVideos}/hashtag`);
  console.log(`   Só com produto: ${requireProduct ? 'sim' : 'não'}`);
  console.log(`   Modo CDP: ${useCdp ? 'sim' : 'não'}`);

  if (useCdp) {
    console.log('\n   ℹ️  Chrome debug (porta 9222) deve estar aberto.');
    console.log('   Se não estiver: scripts\\abrir-chrome-debug.cmd achadinhos\n');
  }

  console.log('   ⏳ Coletando e ranqueando...\n');

  const collected = await collectHashtagsViaCdp(hashtags, {
    maxVideos,
    cdp: useCdp,
    probeForProduct: requireProduct,
    probeLimit: Number(flags['probe-limit'] || 20),
    probeStopOnFirst: true,
    scrolls: Number(flags.scrolls || 12),
  });

  for (const r of collected.results) {
    if (r.unavailable) console.log(`   ⏭️  #${r.hashtag} pulada (indisponível)`);
  }

  const winners = getTopViralVideos(collected.videos, {
    top,
    requireProductId: requireProduct,
    minPlayCount: minPlays,
  });

  let enrichedProducts = [];
  const productIds = [...new Set(winners.map((v) => v.productId).filter(Boolean))].slice(
    0,
    enrichProducts || 0
  );

  if (productIds.length > 0 && useCdp) {
    console.log(`\n   🛒 Buscando detalhes de ${productIds.length} produto(s) do(s) vídeo(s)...\n`);
    const details = await collectProductsViaCdp(
      productIds.map((productId) => ({ productId })),
      { delayMs: 2500, quiet: true }
    );
    enrichedProducts = details.filter((d) => d.success && d.product).map((d) => d.product);
  }

  const payload = {
    collectedAt: collected.collectedAt,
    mode: 'most-viral',
    hashtags,
    filters: {
      top,
      requireProductId: requireProduct,
      minPlayCount: minPlays,
    },
    summary: {
      totalVideosScanned: collected.summary.totalVideos,
      videosWithProduct: collected.summary.videosWithProduct,
      winnersFound: winners.length,
    },
    winners,
    mostViral: winners[0] || null,
    collection: collected,
    enrichedProducts: enrichedProducts.length ? enrichedProducts : undefined,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const timestamp = Date.now();
  const filepath = join(OUTPUT_DIR, `most-viral-${timestamp}.json`);
  const latestPath = join(OUTPUT_DIR, 'most-viral-latest.json');
  const json = JSON.stringify(payload, null, 2);
  await writeFile(filepath, json, 'utf-8');
  await writeFile(latestPath, json, 'utf-8');

  console.log(`\n📄 Resultado: ${filepath}`);
  console.log(`   Atualizado: ${latestPath}`);

  if (winners.length === 0) {
    console.log('\n   ❌ Nenhum vídeo com produto TikTok Shop encontrado.');
    console.log('   💡 Tente: scripts\\abrir-chrome-debug.cmd tiktokshop');
    console.log('   💡 Ou: node src/sync-most-viral.js --cdp --hashtags tiktokshop,achadinhos --no-require-product');
    for (const r of collected.results) {
      if (r.error) console.log(`      #${r.hashtag}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log(`\n   ✅ ${winners.length} vídeo(s) viral(is) encontrado(s):`);
  winners.forEach((video, index) => printVideo(video, index + 1));

  if (enrichedProducts.length > 0) {
    const p = enrichedProducts[0];
    console.log(`\n   🛍️  Produto do #1: ${p.title?.slice(0, 60)}`);
    console.log(`      R$ ${p.price ?? '?'} | Vendidos: ${p.soldCount ?? '?'} | ID: ${p.productId}`);
  }

  if (saveFirebase && isFirebaseConfigured() && enrichedProducts.length > 0) {
    const saved = await saveProductsToFirebase(enrichedProducts, { source: 'most-viral' });
    console.log(`\n🔥 Firebase: ${saved.savedIds.length} produto(s) em "${saved.collection}"`);
  } else if (saveFirebase && !isFirebaseConfigured()) {
    console.log('\n⚠️  Firebase não configurado — resultado só em JSON local');
  }

  console.log('\n   💡 Agendar no Windows: scripts\\rodar-mais-viral.cmd');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
