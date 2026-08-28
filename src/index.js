#!/usr/bin/env node

import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectHashtags } from './collectors/content-collector.js';
import { collectProducts } from './collectors/product-collector.js';
import { discoverPopularProducts, DISCOVERY_SOURCES, shopDiscoveryUrl } from './collectors/shop-discovery-collector.js';
import { config, extractProductId } from './config.js';
import { isFirebaseConfigured, saveProductsToFirebase } from './db/firebase.js';
import { runPipeline } from './pipeline/run-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../output');

function printUsage() {
  console.log(`
PuxarDadosDotiktok — Extrator de dados do TikTok / TikTok Shop

Uso:
  node src/index.js content [--hashtags tag1,tag2] [--playwright] [--output arquivo.json]
  node src/index.js products [--ids id1,id2] [--playwright] [--visible] [--firebase]
  node src/index.js pipeline [--hashtags tag1,tag2]
  node src/index.js discover [--source trending|search|deals] [--query palavra] [--limit 30] [--cdp]
  node src/test-discover.js [--cdp] [--source trending] [--enrich 10]
  node src/save-cookies.js [--url URL]

Exemplos:
  node src/index.js content --hashtags achadinhos,produtosvirais
  node src/index.js products --ids 1729527313880355335
  node src/index.js discover --cdp --source search --query achadinhos
  node src/test-discover.js --cdp --enrich 10
  node src/index.js pipeline
`);
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(arg);
    }
  }

  return args;
}

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function writeOutput(data, filename) {
  await ensureOutputDir();
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\nResultado salvo em: ${filepath}`);
  return filepath;
}

async function cmdContent(flags) {
  const hashtags = flags.hashtags
    ? flags.hashtags.split(',').map((t) => t.trim())
    : config.defaultHashtags;

  const usePlaywright = Boolean(flags.playwright);

  console.log(`Coletando hashtags: ${hashtags.join(', ')}`);
  const result = await collectHashtags(hashtags, { usePlaywright });

  const filename = flags.output || `content-${Date.now()}.json`;
  await writeOutput(result, filename);

  console.log(`\nResumo:`);
  console.log(`  Hashtags: ${result.summary.successfulHashtags}/${result.summary.totalHashtags}`);
  console.log(`  Vídeos: ${result.summary.totalVideos}`);
  console.log(`  Product IDs: ${result.summary.uniqueProductIds}`);

  return result;
}

async function cmdProducts(flags) {
  if (!flags.ids) {
    console.error('Erro: --ids é obrigatório para o comando products');
    process.exit(1);
  }

  const productIds = flags.ids.split(',').map((id) => extractProductId(id.trim()));
  const usePlaywright = flags.playwright !== false;
  const visible = Boolean(flags.visible);
  const saveFirebase = Boolean(flags.firebase);

  console.log(`Coletando ${productIds.length} produto(s)...`);
  const result = await collectProducts(productIds, { usePlaywright, visible });

  const filename = flags.output || `products-${Date.now()}.json`;
  await writeOutput(result, filename);

  console.log(`\nResumo:`);
  console.log(`  Produtos: ${result.summary.successfulProducts}/${result.summary.totalProducts}`);

  if (saveFirebase && result.products.length > 0 && isFirebaseConfigured()) {
    const saved = await saveProductsToFirebase(result.products, { source: 'cli-products' });
    console.log(`  Firebase: ${saved.savedIds.length} em "${saved.collection}"`);
  }

  for (const r of result.results) {
    if (r.success && r.product) {
      const p = r.product;
      console.log(`  ✅ ${p.title?.slice(0, 50) || p.productId} | R$ ${p.price ?? '?'} | ${p.soldCount ?? '?'} vendidos`);
    } else if (!r.success) {
      console.log(`  ❌ ${r.productId}: ${r.error}`);
    }
  }

  return result;
}

async function cmdDiscover(flags) {
  const source = flags.source || 'trending';
  const query = flags.query || null;
  const limit = Number(flags.limit) || 30;
  const useCdp = flags['no-cdp'] ? false : true;

  console.log(`Descobrindo produtos populares (${source})...`);
  if (query) console.log(`Busca: "${query}"`);
  console.log(`URL: ${shopDiscoveryUrl(source, { query })}`);

  const discovery = await discoverPopularProducts({
    source,
    query,
    limit,
    cdp: useCdp,
    visible: Boolean(flags.visible),
    fallbackBrowser: !useCdp,
  });

  const result = {
    collectedAt: new Date().toISOString(),
    discovery,
    products: discovery.products,
    summary: {
      discovered: discovery.products.length,
      source,
      query,
      success: discovery.success,
    },
  };

  const filename = flags.output || `discover-${source}-${Date.now()}.json`;
  await writeOutput(result, filename);

  console.log(`\nResumo: ${discovery.products.length} produto(s) — ${DISCOVERY_SOURCES[source] || source}`);

  for (const [index, product] of discovery.products.entries()) {
    const title = product.title?.slice(0, 50) || product.productId;
    console.log(
      `  ${index + 1}. ${title} | R$ ${product.price ?? '?'} | ${product.soldCount ?? '?'} vendidos`
    );
  }

  if (!discovery.success) {
    console.log(`\n❌ ${discovery.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdPipeline(flags) {
  const hashtags = flags.hashtags
    ? flags.hashtags.split(',').map((t) => t.trim())
    : config.defaultHashtags;

  return runPipeline({
    hashtags,
    saveToFirebase: Boolean(flags.firebase),
    usePlaywright: flags['no-playwright'] !== true,
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || flags.help) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case 'content':
        await cmdContent(flags);
        break;
      case 'products':
        await cmdProducts(flags);
        break;
      case 'discover':
        await cmdDiscover(flags);
        break;
      case 'pipeline':
        await cmdPipeline(flags);
        break;
      default:
        console.error(`Comando desconhecido: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Erro: ${error.message}`);
    process.exit(1);
  }
}

main();
