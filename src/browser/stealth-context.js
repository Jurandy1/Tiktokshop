import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { config, TIKTOK_HEADERS } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CHROME_PROFILE_PATH = join(__dirname, '../../cookies/chrome-profile');

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
`;

export const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-infobars',
];

export const MOBILE_CONTEXT_OPTIONS = {
  userAgent: TIKTOK_HEADERS['User-Agent'],
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

export const DESKTOP_CONTEXT_OPTIONS = {
  userAgent: DESKTOP_USER_AGENT,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1280, height: 800 },
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

/**
 * Modo visível: Chrome real com perfil persistente (captcha funciona como browser normal).
 * Sem scripts de stealth que quebram CSP do captcha OEC.
 */
export async function launchPersistentBrowser(options = {}) {
  const { chromium } = await import('playwright');
  await mkdir(CHROME_PROFILE_PATH, { recursive: true });

  const launchOptions = {
    headless: false,
    slowMo: 50,
    ...DESKTOP_CONTEXT_OPTIONS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ...(config.proxyUrl ? { proxy: { server: config.proxyUrl } } : {}),
  };

  try {
    const context = await chromium.launchPersistentContext(CHROME_PROFILE_PATH, {
      ...launchOptions,
      channel: 'chrome',
    });
    return { context, channel: 'chrome', persistent: true };
  } catch {
    const context = await chromium.launchPersistentContext(CHROME_PROFILE_PATH, launchOptions);
    return { context, channel: 'chromium', persistent: true };
  }
}

/**
 * Modo headless: browser temporário com stealth mobile.
 */
export async function launchStealthBrowser(options = {}) {
  const { chromium } = await import('playwright');

  const launchOptions = {
    headless: true,
    args: STEALTH_LAUNCH_ARGS,
    ...(config.proxyUrl ? { proxy: { server: config.proxyUrl } } : {}),
  };

  try {
    const browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
    return { browser, channel: 'chrome', persistent: false };
  } catch {
    const browser = await chromium.launch(launchOptions);
    return { browser, channel: 'chromium', persistent: false };
  }
}

export async function createStealthContext(browser, options = {}) {
  const context = await browser.newContext({
    ...MOBILE_CONTEXT_OPTIONS,
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });

  if (!options.skipStealthScript) {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  }
  return context;
}

/**
 * Abre sessão de browser adequada ao modo.
 * visible=true → perfil Chrome persistente (desktop, sem stealth script)
 * visible=false → headless stealth
 */
export async function openBrowserSession(options = {}) {
  if (options.visible) {
    const { context, channel } = await launchPersistentBrowser(options);
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    return {
      context,
      page,
      browser: null,
      channel,
      persistent: true,
      async close() {
        await context.close();
      },
      async getStorageState() {
        return context.storageState();
      },
    };
  }

  const { browser, channel } = await launchStealthBrowser(options);
  const context = await createStealthContext(browser, {
    storageState: options.storageState,
  });
  const page = await context.newPage();

  return {
    context,
    page,
    browser,
    channel,
    persistent: false,
    async close() {
      await context.close();
      await browser.close();
    },
    async getStorageState() {
      return context.storageState();
    },
  };
}

export async function warmUpSession(page, options = {}) {
  const region = config.region.toLowerCase();
  const warmupUrl = options.warmupUrl || `https://www.tiktok.com/shop?region=${region}`;

  await page.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(options.warmupDelayMs ?? 3000);

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(1000);
}

export function isRateLimitedContent(html) {
  const text = String(html || '').toLowerCase();
  return (
    text.includes('muita frequência') ||
    text.includes('muita frequencia') ||
    text.includes('too frequently') ||
    text.includes('too many requests') ||
    text.includes('acessando nosso serviço') ||
    text.includes('rate limit')
  );
}

export function isSecurityCheck(title) {
  return String(title || '').toLowerCase().includes('security');
}

export function isSecurityCheckContent(html) {
  const text = String(html || '').toLowerCase();
  return (
    text.includes('security check') ||
    text.includes('captcha') ||
    text.includes('verify to continue') ||
    text.includes('oec_verify')
  );
}

export async function waitForCaptchaResolved(page, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 300000;
  const pollMs = 2000;

  if (options.visible) {
    console.log('   ⏳ Resolva o captcha na janela do Chrome.');
    console.log('   Se o puzzle NÃO aparecer (tela em branco), feche o Chrome e rode de novo.');
    console.log('   Quando a página DO PRODUTO carregar, pressione ENTER no terminal.\n');

    const enterPromise = new Promise((resolve) => {
      if (!process.stdin.isTTY) return;
      process.stdin.resume();
      process.stdin.once('data', () => resolve('enter'));
    });

    const pollPromise = (async () => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const title = await page.title();
        const html = await page.content();
        if (!isSecurityCheck(title) && !isSecurityCheckContent(html)) {
          return 'auto';
        }
        await page.waitForTimeout(pollMs);
      }
      return 'timeout';
    })();

    const winner = await Promise.race([enterPromise, pollPromise].filter(Boolean));

    if (winner === 'timeout') {
      throw new Error('Tempo esgotado aguardando captcha');
    }

    await page.waitForTimeout(1500);
    return;
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const title = await page.title();
    if (!isSecurityCheck(title)) return;
    await page.waitForTimeout(pollMs);
  }
}

export function attachNetworkCapture(page, handlers = {}) {
  const captured = {
    products: [],
    itemLists: [],
    rawResponses: [],
  };

  page.on('response', async (response) => {
    const url = response.url();
    const isRelevant =
      url.includes('item_list') ||
      url.includes('challenge') ||
      url.includes('aweme') ||
      url.includes('post/item') ||
      url.includes('product') ||
      url.includes('pdp') ||
      url.includes('/api/') ||
      url.includes('oec');

    if (!isRelevant || response.status() !== 200) return;

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json') && !contentType.includes('text')) return;

      const json = await response.json();
      captured.rawResponses.push({ url, json });

      if (handlers.onProduct) {
        const product = handlers.onProduct(json);
        if (product) captured.products.push(product);
      }

      if (json.itemList?.length) {
        captured.itemLists.push(...json.itemList);
      }

      if (handlers.onResponse) {
        handlers.onResponse(url, json, captured);
      }
    } catch {
      // resposta não-JSON
    }
  });

  return captured;
}
