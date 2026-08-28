#!/usr/bin/env node

/**
 * Comparador: mesmo productId no ScrapeCreators × no nosso Playwright CDP.
 *
 * Objetivo: descobrir o que a API paga tem que o caseiro ainda não pega,
 * pra guiar melhorias no scraper local (X-Bogus, headers, endpoints internos).
 *
 * Rode com o Chrome debug já aberto:
 *   scripts\abrir-chrome-debug.cmd
 *   node src/collectors/scrapecreators-probe.js --product 1731172563256837522
 *   node src/collectors/scrapecreators-probe.js --product 1731172563256837522 --skip-cdp
 *
 * Custo: 1 crédito por productId.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { product as scProduct } from './scrapecreators.js';
import { collectProductViaCdp } from './cdp-collector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../../output/probe');

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

/** Coleta recursivamente todos os paths com valores primitivos (só topo, até 3 níveis). */
function flatten(obj, prefix = '', depth = 0, out = new Map()) {
  if (obj == null || depth > 3) return out;
  if (Array.isArray(obj)) {
    out.set(prefix, `Array(${obj.length})`);
    if (obj[0] != null && typeof obj[0] === 'object') flatten(obj[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v == null || typeof v !== 'object') {
        out.set(path, typeof v === 'string' && v.length > 60 ? `"${v.slice(0, 60)}…"` : v);
      } else {
        flatten(v, path, depth + 1, out);
      }
    }
  }
  return out;
}

function diffKeys(scMap, cdpMap) {
  const onlySc = [];
  const onlyCdp = [];
  const both = [];
  for (const key of scMap.keys()) {
    if (cdpMap.has(key)) both.push(key);
    else onlySc.push(key);
  }
  for (const key of cdpMap.keys()) {
    if (!scMap.has(key)) onlyCdp.push(key);
  }
  return { onlySc, onlyCdp, both };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const productId = flags.product || flags.id;
  if (!productId) {
    console.error('Uso: node src/collectors/scrapecreators-probe.js --product <productId>');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = Date.now();
  const pdpUrl = productId.startsWith('http')
    ? productId
    : `https://www.tiktok.com/shop/pdp/${productId}`;

  console.log(`\n🧪 Probe productId=${productId}\n`);

  // 1) ScrapeCreators
  console.log('   ▶ ScrapeCreators /v1/tiktok/product ...');
  let scResp;
  try {
    scResp = await scProduct(pdpUrl, { region: 'BR' });
  } catch (err) {
    console.error(`   ❌ ScrapeCreators falhou: ${err.message}`);
    process.exit(1);
  }
  const scPath = join(OUT_DIR, `sc-${productId}-${stamp}.json`);
  await writeFile(scPath, JSON.stringify(scResp, null, 2), 'utf-8');
  console.log(`   ✅ salvo: ${scPath}`);
  console.log(`      créditos restantes: ${scResp._meta.creditsRemaining}`);

  // 2) Caseiro via CDP (opcional — precisa Chrome debug aberto)
  let cdpResp = null;
  if (!flags['skip-cdp']) {
    console.log('\n   ▶ Nosso Playwright CDP (precisa Chrome debug aberto) ...');
    try {
      const results = await collectProductViaCdp({ productId }, { quiet: true });
      cdpResp = results?.product || results || null;
      const cdpPath = join(OUT_DIR, `cdp-${productId}-${stamp}.json`);
      await writeFile(cdpPath, JSON.stringify(cdpResp, null, 2), 'utf-8');
      console.log(`   ✅ salvo: ${cdpPath}`);
    } catch (err) {
      console.error(`   ⚠  CDP falhou (segue só com ScrapeCreators): ${err.message}`);
    }
  } else {
    console.log('\n   ⏭  --skip-cdp: pulando comparação com Playwright');
  }

  // 3) Diff
  if (cdpResp) {
    const scData = scResp.data || scResp;
    const scMap = flatten(scData);
    const cdpMap = flatten(cdpResp);
    const { onlySc, onlyCdp, both } = diffKeys(scMap, cdpMap);

    const report = {
      productId,
      pdpUrl,
      timestamp: new Date().toISOString(),
      scrapecreatorsFields: scMap.size,
      cdpFields: cdpMap.size,
      inBoth: both.length,
      onlyScrapeCreators: onlySc,
      onlyOurCdp: onlyCdp,
      hint:
        'Campos em "onlyScrapeCreators" são o que precisamos aprender a extrair pro caseiro ' +
        'ficar equivalente. Cruze com o guia scripts/mapear-endpoints.md.',
    };
    const reportPath = join(OUT_DIR, `diff-${productId}-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`\n📊 Diff:`);
    console.log(`   Campos ScrapeCreators : ${scMap.size}`);
    console.log(`   Campos nosso CDP      : ${cdpMap.size}`);
    console.log(`   Em ambos              : ${both.length}`);
    console.log(`   Só ScrapeCreators     : ${onlySc.length}`);
    console.log(`   Só nosso              : ${onlyCdp.length}`);
    console.log(`\n   📄 relatório: ${reportPath}`);
    if (onlySc.length) {
      console.log(`\n   🔍 Amostra do que só o ScrapeCreators tem (top 15):`);
      onlySc.slice(0, 15).forEach((k) => console.log(`      • ${k}`));
    }
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
