#!/usr/bin/env node

/**
 * Abre o TikTok Shop no browser pra você logar/resolver captcha
 * e salva os cookies em cookies/tiktok-state.json
 *
 * Uso:
 *   node src/save-cookies.js
 *   node src/save-cookies.js --url "https://www.tiktok.com/view/product/SEU_ID?region=br"
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { TIKTOK_HEADERS } from './config.js';
import { ANONYMOUS_STATE_PATH } from './session/anonymous-session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_DIR = join(__dirname, '../cookies');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const url =
    flags.url ||
    'https://www.tiktok.com/shop?region=br';

  await mkdir(COOKIES_DIR, { recursive: true });

  console.log('\n🌐 Abrindo browser — faça login no TikTok Shop se necessário');
  console.log(`   URL: ${url}`);
  console.log('   Feche a janela ou pressione Enter no terminal quando terminar\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: TIKTOK_HEADERS['User-Agent'],
    locale: 'pt-BR',
    viewport: { width: 390, height: 844 },
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
    setTimeout(resolve, 120000);
  });

  const storageState = await context.storageState();
  const outPath = flags.output || ANONYMOUS_STATE_PATH;
  await writeFile(outPath, JSON.stringify(storageState, null, 2), 'utf-8');

  await browser.close();

  console.log(`\n✅ Cookies salvos em: ${outPath}`);
  console.log('   Agora rode: node src/test-shop.js --ids SEU_PRODUCT_ID\n');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
