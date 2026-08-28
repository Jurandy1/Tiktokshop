import { config, TIKTOK_HEADERS } from '../config.js';
import { buildCookieHeader } from './anonymous-session.js';

const signedUrlCache = new Map();

function cacheKey(url) {
  return url.split('?')[0];
}

function getCached(url) {
  const entry = signedUrlCache.get(cacheKey(url));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    signedUrlCache.delete(cacheKey(url));
    return null;
  }
  return entry;
}

function setCache(baseUrl, signedUrl, headers = {}) {
  signedUrlCache.set(cacheKey(baseUrl), {
    signedUrl,
    headers,
    expiresAt: Date.now() + config.signedUrlTtlMs,
  });
}

/**
 * Assina URL via browser: dispara fetch interno com cookies da sessão anônima.
 */
export async function signUrlViaBrowser(apiUrl, storageState, options = {}) {
  const cached = getCached(apiUrl);
  if (cached) return cached;

  const { launchStealthBrowser, createStealthContext, warmUpSession } = await import(
    '../browser/stealth-context.js'
  );

  const { browser } = await launchStealthBrowser(options);

  try {
    const context = await createStealthContext(browser, { storageState });
    const page = await context.newPage();

    let signedUrl = null;
    let signedHeaders = {};
    const endpoint = new URL(apiUrl).pathname;

    page.on('request', (request) => {
      const reqUrl = request.url();
      if (!reqUrl.includes(endpoint)) return;

      signedUrl = reqUrl;
      signedHeaders = request.headers();
    });

    await warmUpSession(page, { warmupDelayMs: 2000 });

    const triggerUrl = options.triggerUrl || 'https://www.tiktok.com/';
    await page.goto(triggerUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    await page.evaluate(async (url) => {
      try {
        await fetch(url, { credentials: 'include' });
      } catch {
        // ignore
      }
    }, apiUrl);

    await page.waitForTimeout(3000);

    if (!signedUrl) {
      const cookieHeader = buildCookieHeader(storageState);
      const result = {
        signedUrl: apiUrl,
        headers: {
          ...TIKTOK_HEADERS,
          Referer: 'https://www.tiktok.com/',
          Accept: 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      };
      setCache(apiUrl, result.signedUrl, result.headers);
      return result;
    }

    const result = {
      signedUrl,
      headers: {
        ...TIKTOK_HEADERS,
        Referer: 'https://www.tiktok.com/',
        Accept: 'application/json',
        ...signedHeaders,
      },
    };
    setCache(apiUrl, result.signedUrl, result.headers);
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Fetch assinado usando sessão anônima + cookies.
 */
export async function fetchSignedApi(apiUrl, storageState, options = {}) {
  const cookieHeader = buildCookieHeader(storageState);

  const response = await fetch(apiUrl, {
    headers: {
      ...TIKTOK_HEADERS,
      Referer: options.referer || 'https://www.tiktok.com/',
      Accept: 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  const text = await response.text();
  if (!text) {
    return { ok: false, status: response.status, data: null, needsBrowserSign: true };
  }

  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(text), needsBrowserSign: false };
  } catch {
    return { ok: false, status: response.status, data: null, needsBrowserSign: true };
  }
}

/**
 * Fetch com retry: cookies anônimos → signer via browser.
 */
export async function fetchWithAnonymousSession(apiUrl, storageState, options = {}) {
  let result = await fetchSignedApi(apiUrl, storageState, options);

  if (result.data && (result.data.itemList?.length || result.data.product || result.data.productInfo)) {
    return { ...result, source: 'signed-api-cookies' };
  }

  if (result.needsBrowserSign || !result.data) {
    const signed = await signUrlViaBrowser(apiUrl, storageState, options);
    const res = await fetch(signed.signedUrl, { headers: signed.headers });
    const text = await res.text();

    if (!text) {
      return { ok: false, status: res.status, data: null, needsBrowserSign: true, source: 'signed-api-browser' };
    }

    try {
      result = { ok: res.ok, status: res.status, data: JSON.parse(text), needsBrowserSign: false };
    } catch {
      result = { ok: false, status: res.status, data: null, needsBrowserSign: true };
    }
    return { ...result, source: 'signed-api-browser' };
  }

  return { ...result, source: 'signed-api-cookies' };
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}
