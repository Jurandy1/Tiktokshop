#!/usr/bin/env node

/**
 * Mapeamento automático de endpoints internos do TikTok Shop BR.
 *
 * Sobe um Playwright stealth ANÔNIMO (não precisa Chrome debug), navega numa
 * PDP e captura TODAS as chamadas de rede relevantes (/api/, /aweme/, /oec/, etc.)
 * com URL, método, params, headers e response body.
 *
 * Objetivo: mapear os endpoints reais que o site chama pra a gente replicar
 * no scraper caseiro (src/collectors/tiktok-shop-direct.js).
 *
 * Rode:
 *   node scripts/auto-mapear-endpoints.js
 *   node scripts/auto-mapear-endpoints.js --product 1731172563256837522
 *   node scripts/auto-mapear-endpoints.js --product 1735669200686122531 --visible
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { openBrowserSession, warmUpSession } from '../src/browser/stealth-context.js';
import { getOrRefreshAnonymousSession, persistStorageState } from '../src/session/anonymous-session.js';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

async function tryConnectCdp() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    if (!contexts.length) {
      await browser.close();
      return null;
    }
    return { browser, context: contexts[0], mode: 'cdp' };
  } catch {
    return null;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../output/probe');

const RELEVANT_PATTERNS = [
  '/api/shop',
  '/api/product',
  '/api/pdp',
  '/api/aweme',
  '/api/comment',
  '/api/mall',
  '/api/feed',
  '/api/discover',
  '/api/search',
  '/api/related',
  '/oec/',
  'oec_api',
];

function isRelevantUrl(url, captureAll = false) {
  if (captureAll) {
    // ainda ignora estáticos ruidosos
    return !/\.(png|jpe?g|webp|gif|svg|woff2?|ttf|css|mp4|m4s|ts|js|ico)(\?|$)/i.test(url);
  }
  const lower = url.toLowerCase();
  return RELEVANT_PATTERNS.some((p) => lower.includes(p));
}

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
  const productId = flags.product || '1731172563256837522';
  const pdpUrl = productId.startsWith('http')
    ? productId
    : `https://www.tiktok.com/shop/pdp/${productId}`;

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\n🗺  Auto-mapping endpoints em ${pdpUrl}`);

  let mode = 'headless-anon';
  let browserSession = null;

  if (!flags['no-cdp']) {
    console.log(`   ▶ Tentando Chrome debug em ${CDP_URL} ...`);
    const cdp = await tryConnectCdp();
    if (cdp) {
      mode = 'cdp';
      const page = (await cdp.context.pages().find?.((p) => !p.isClosed())) || (await cdp.context.newPage());
      browserSession = {
        page,
        context: cdp.context,
        async close() { await cdp.browser.close(); },
      };
      console.log(`     ✅ Conectado ao Chrome debug (aba já aberta reutilizada)`);
    } else {
      console.log(`     ⚠  Chrome debug indisponível — caindo pra ${flags.visible ? 'visible' : 'headless anônimo'}`);
    }
  }

  if (!browserSession) {
    console.log('   ▶ Reaproveitando sessão anônima (msToken/ttwid)...');
    const session = await getOrRefreshAnonymousSession({ visible: Boolean(flags.visible) });
    console.log(`     cookies: ${session.keyCookies ? Object.keys(session.keyCookies).join(', ') : '?'}`);
    browserSession = await openBrowserSession({
      visible: Boolean(flags.visible),
      storageState: session.storageState,
    });
    mode = flags.visible ? 'visible' : 'headless-anon';
  }

  console.log(`   Modo efetivo: ${mode}\n`);
  const { page, context, close } = browserSession;

  // Coletores
  const requests = new Map(); // requestId → { url, method, headers, postData }
  const captured = [];

  const captureAll = Boolean(flags.all);

  page.on('request', (req) => {
    const url = req.url();
    if (!isRelevantUrl(url, captureAll)) return;
    requests.set(url, {
      url,
      method: req.method(),
      headers: req.headers(),
      postData: req.postData() || null,
    });
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!isRelevantUrl(url, captureAll) || res.status() !== 200) return;
    const contentType = res.headers()['content-type'] || '';
    if (!contentType.includes('json') && !contentType.includes('text')) return;

    let body = null;
    try {
      body = await res.json();
    } catch {
      try { body = { _text: (await res.text()).slice(0, 500) }; } catch { /* ignore */ }
    }

    const reqInfo = requests.get(url) || {};
    captured.push({
      url,
      method: reqInfo.method || 'GET',
      status: res.status(),
      requestHeaders: reqInfo.headers || {},
      responseHeaders: res.headers(),
      postData: reqInfo.postData || null,
      responseBody: body,
    });
  });

  try {
    if (mode !== 'cdp') {
      console.log(`\n   ▶ Warm-up em www.tiktok.com/shop?region=br ...`);
      await warmUpSession(page, { warmupDelayMs: 4000 });
    }

    console.log(`   ▶ Navegando PDP: ${pdpUrl}`);
    await page.goto(pdpUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(4000);

    const scrolls = Number(flags.scrolls || 6);
    console.log(`   ▶ Rolando ${scrolls}x (0.6x viewport, 2s cada) pra disparar reviews/related...`);
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.6));
      await page.waitForTimeout(2000);
    }
    // Também tenta clicar em abas "Comentários" / "Vídeos" se existirem
    try {
      const clicked = await page.evaluate(() => {
        const spots = ['Comentários', 'Reviews', 'Vídeos', 'Related', 'Ver mais'];
        const btns = [...document.querySelectorAll('button,a,[role="tab"],[role="button"]')];
        let n = 0;
        for (const el of btns) {
          const t = (el.innerText || '').trim();
          if (spots.some((s) => t.toLowerCase().includes(s.toLowerCase()))) {
            el.click();
            n++;
          }
        }
        return n;
      });
      if (clicked) {
        console.log(`   ▶ Cliquei em ${clicked} aba(s) tipo comentários/vídeos`);
        await page.waitForTimeout(4000);
      }
    } catch { /* ignore */ }
    await page.waitForTimeout(2000);

    const finalTitle = await page.title();
    const finalUrl = page.url();
    console.log(`\n   ⛳ terminou em: ${finalUrl} | title: "${finalTitle.slice(0, 60)}"`);

    // Salvar HTML final da PDP (contém hydration com dados do produto principal)
    try {
      const html = await page.content();
      const htmlPath = join(OUT_DIR, `pdp-html-${productId.replace(/[^\w]/g, '_')}-${Date.now()}.html`);
      await writeFile(htmlPath, html, 'utf-8');
      console.log(`   📄 HTML salvo: ${htmlPath} (${(html.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.log(`   ⚠  Não deu pra salvar HTML: ${err.message}`);
    }

    // Persistir sessão atualizada
    try {
      const storageState = await context.storageState();
      await persistStorageState(storageState);
    } catch { /* CDP context às vezes recusa storageState — ignora */ }

    // Salvar captura
    const stamp = Date.now();
    const outPath = join(OUT_DIR, `endpoints-mapa-${productId.replace(/[^\w]/g, '_')}-${stamp}.json`);

    // Sumário legível
    const uniquePaths = [
      ...new Set(
        captured.map((c) => {
          try {
            const u = new URL(c.url);
            return `${c.method} ${u.origin}${u.pathname}`;
          } catch {
            return c.url;
          }
        })
      ),
    ];

    const summary = {
      productId,
      pdpUrl,
      capturedAt: new Date().toISOString(),
      finalUrl,
      finalTitle,
      totalCaptured: captured.length,
      uniquePaths,
      pageTitle: finalTitle,
    };

    await writeFile(
      outPath,
      JSON.stringify({ summary, captured }, null, 2),
      'utf-8'
    );

    console.log(`\n📄 Salvo: ${outPath}`);
    console.log(`   Total de responses capturadas: ${captured.length}`);
    console.log(`   Endpoints únicos: ${uniquePaths.length}`);
    if (uniquePaths.length) {
      console.log(`\n   🎯 Endpoints identificados:`);
      uniquePaths.slice(0, 40).forEach((p) => console.log(`      ${p}`));
    } else {
      console.log(`\n   ⚠  Nenhum endpoint /api/ capturado.`);
      console.log(`   Provavelmente captcha ou rate limit. Tente:`);
      console.log(`      node scripts/auto-mapear-endpoints.js --visible`);
      console.log(`      (resolve o captcha manualmente e refaz)`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
