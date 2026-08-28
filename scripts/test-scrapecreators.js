#!/usr/bin/env node

/**
 * Teste rápido do ScrapeCreators com região BR.
 *
 * Rode:
 *   node scripts/test-scrapecreators.js
 *   node scripts/test-scrapecreators.js --query tiktokshop
 *   node scripts/test-scrapecreators.js --product 1731172563256837522
 *
 * Cada chamada = 1 crédito. Salva JSON bruto em output/probe/.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shopSearch, product, normalizeSearchProduct } from '../src/collectors/scrapecreators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../output/probe');

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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const query = flags.query || 'achadinhos';

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\n🔎 ScrapeCreators shop/search  query="${query}" region=BR`);
  const search = await shopSearch(query, { region: 'BR' });
  const stamp = Date.now();
  await writeFile(
    join(OUT_DIR, `shop-search-${query}-${stamp}.json`),
    JSON.stringify(search, null, 2),
    'utf-8'
  );

  console.log(`   ✅ ${search.products?.length || 0} produto(s) | créditos: ${search._meta.creditsRemaining}`);

  const rows = (search.products || []).map(normalizeSearchProduct);
  rows
    .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0))
    .slice(0, 10)
    .forEach((p, i) => {
      const price = p.price.currency && p.price.saleFormatted
        ? `${p.price.currency}${p.price.saleFormatted}`
        : '?';
      console.log(
        `   ${String(i + 1).padStart(2, '0')} ${p.title?.slice(0, 55).padEnd(55)} ${price.padStart(10)} • ${p.soldCount ?? '?'} vendidos`
      );
    });

  if (flags.product) {
    const pdpUrl = flags.product.startsWith('http')
      ? flags.product
      : `https://www.tiktok.com/shop/pdp/${flags.product}`;
    console.log(`\n🛒 ScrapeCreators product  ${pdpUrl}`);
    const detail = await product(pdpUrl, { region: 'BR' });
    await writeFile(
      join(OUT_DIR, `product-${flags.product.replace(/[^\w]/g, '_')}-${stamp}.json`),
      JSON.stringify(detail, null, 2),
      'utf-8'
    );
    const related = detail.related_videos || detail.data?.related_videos || [];
    console.log(`   ✅ créditos: ${detail._meta.creditsRemaining} | related_videos: ${related.length}`);
  }

  console.log(`\n📄 JSONs salvos em output/probe/`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
