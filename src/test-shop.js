#!/usr/bin/env node

/**
 * Teste rápido: puxa produto(s) do TikTok Shop via sessão anônima (sem login).
 *
 * Uso:
 *   node src/test-shop.js
 *   node src/test-shop.js --ids 1729527313880355335
 *   node src/test-shop.js --visible
 *   node src/test-shop.js --firebase
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectProducts } from './collectors/product-collector.js';
import { collectProductsViaCdp } from './collectors/cdp-collector.js';
import { config, extractProductId, resolveProductInput } from './config.js';
import { isFirebaseConfigured, saveProductsToFirebase } from './db/firebase.js';
import { getSessionSummary, getOrRefreshAnonymousSession } from './session/anonymous-session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../output');

const SAMPLE_IDS = ['1729527313880355335'];

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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const ids = (flags.ids || SAMPLE_IDS.join(','))
    .split(',')
    .map((raw) => resolveProductInput(raw.trim()))
    .filter((r) => r.productId);

  const visible = Boolean(flags.visible);
  const useCdp = Boolean(flags.cdp);
  const saveFirebase = Boolean(flags.firebase);

  console.log('\n🛒 Teste TikTok Shop (sessão anônima — sem login)');
  console.log(`   Produtos: ${ids.map((r) => r.productId).join(', ')}`);
  console.log(`   URLs: ${ids.map((r) => r.url).join(' | ')}`);
  console.log(`   Região: ${config.region}`);
  console.log(`   Modo CDP: ${useCdp ? 'sim (Chrome seu)' : 'não'}`);
  console.log(`   Playwright visível: ${visible ? 'sim' : 'não'}`);
  console.log(`   Firebase: ${saveFirebase ? 'sim' : 'não'}`);

  if (useCdp) {
    console.log('\n   ℹ️  Modo CDP: o script conecta no Chrome que VOCÊ abriu.');
    console.log('   1. Rode: scripts\\abrir-chrome-debug.cmd');
    console.log('   2. Faça login / abra o produto no Chrome');
    console.log('   3. Rode este comando com --cdp\n');
  } else if (!visible) {
    console.log('\n   ℹ️  Sem --visible o Chrome roda OCULTO (headless).');
    console.log('   Para ver a janela: --visible | Se rate limit: use --cdp\n');
  } else {
    console.log('\n   🌐 O Chrome vai abrir em instantes...\n');
  }

  console.log('   ⏳ Coletando...\n');

  let result;
  let sessionSummary = null;

  if (useCdp) {
    const cdpResults = await collectProductsViaCdp(ids, { delayMs: 2500, quiet: false });
    const products = cdpResults.filter((r) => r.product).map((r) => r.product);
    result = {
      collectedAt: new Date().toISOString(),
      results: cdpResults,
      products,
      summary: {
        totalProducts: ids.length,
        successfulProducts: cdpResults.filter((r) => r.success).length,
      },
    };
  } else {
    const session = await getOrRefreshAnonymousSession({ visible });
    sessionSummary = getSessionSummary(session);
    console.log(`   Sessão: ${session.refreshed ? 'nova' : 'cache'} | cookies: ${Object.keys(session.keyCookies || {}).join(', ')}\n`);

    result = await collectProducts(
      ids.map((r) => r.productId),
      {
        usePlaywright: true,
        visible,
        urls: Object.fromEntries(ids.map((r) => [r.productId, r.url])),
      }
    );
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = join(OUTPUT_DIR, `test-shop-${Date.now()}.json`);
  await writeFile(filepath, JSON.stringify({ sessionSummary, ...result }, null, 2), 'utf-8');

  console.log(`\n📄 Resultado: ${filepath}`);
  console.log(`   Sucesso: ${result.summary.successfulProducts}/${result.summary.totalProducts}\n`);

  for (const r of result.results) {
    if (r.success && r.product) {
      const p = r.product;
      console.log(`   ✅ [${r.source}] ${r.productId}`);
      console.log(`      ${p.title?.slice(0, 60) || '(sem título)'}`);
      const ratingLabel =
        p.rating != null
          ? `${p.rating}${p.ratingCount ? ` (${p.ratingCount} avaliações)` : ''}`
          : p.ratingCount
            ? `? (${p.ratingCount} avaliações)`
            : '?';
      console.log(`      Preço: R$ ${p.price ?? '?'} | Vendidos: ${p.soldCount ?? '?'} | Rating: ${ratingLabel}`);
    } else {
      console.log(`   ❌ ${r.productId}: ${r.error}`);
      if (r.pageTitle) console.log(`      Página: ${r.pageTitle}`);
      if (r.sessionSummary) console.log(`      Sessão: ${JSON.stringify(r.sessionSummary)}`);
    }
  }

  if (result.products.length > 0 && saveFirebase) {
    if (!isFirebaseConfigured()) {
      console.log('\n⚠️  Firebase não configurado — resultado só salvo em JSON local');
    } else {
      try {
        const saved = await saveProductsToFirebase(result.products, { source: 'test-shop' });
        console.log(`\n🔥 Firebase: ${saved.savedIds.length} produto(s) em "${saved.collection}"`);
      } catch (err) {
        console.log(`\n⚠️  Firebase falhou: ${err.message}`);
      }
    }
  }

  if (result.summary.successfulProducts === 0) {
    const rateLimited = result.results.some((r) => r.isRateLimited);
    console.log(rateLimited
      ? `
⛔ TikTok bloqueou por excesso de requisições (rate limit).

Tente o modo CDP (usa SEU Chrome, sem abrir browser novo):

   1. scripts\\abrir-chrome-debug.cmd
   2. Faça login e abra o produto no Chrome
   3. node src/test-shop.js --ids 1734150389017314840 --cdp
`
      : useCdp
        ? `
💡 Modo CDP falhou. Confira:
   1. Chrome aberto via scripts\\abrir-chrome-debug.cmd
   2. Produto carregado na aba (não tela de login)
   3. Rode --cdp com o Chrome ainda aberto
`
        : `
💡 Tente modo CDP (contorna rate limit):
   1. scripts\\abrir-chrome-debug.cmd
   2. Login + abra o produto
   3. node src/test-shop.js --ids SEU_ID --cdp
`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
