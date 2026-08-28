import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import {
  openBrowserSession,
  warmUpSession,
} from '../browser/stealth-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ANONYMOUS_STATE_PATH = join(__dirname, '../../cookies/anonymous-state.json');
export const ANONYMOUS_META_PATH = join(__dirname, '../../cookies/anonymous-meta.json');

const KEY_COOKIES = ['msToken', 'ttwid', 'tt_webid', 's_v_web_id', 'odin_tt'];

function extractKeyCookies(storageState) {
  const cookies = storageState?.cookies || [];
  const found = {};

  for (const name of KEY_COOKIES) {
    const cookie = cookies.find((c) => c.name === name);
    if (cookie) found[name] = cookie.value;
  }

  return found;
}

function hasMinimumCookies(keyCookies) {
  return Boolean(keyCookies.msToken || keyCookies.ttwid);
}

async function readMeta() {
  if (!existsSync(ANONYMOUS_META_PATH)) return null;

  try {
    const raw = await readFile(ANONYMOUS_META_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readStorageState() {
  if (!existsSync(ANONYMOUS_STATE_PATH)) return null;

  try {
    const raw = await readFile(ANONYMOUS_STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isExpired(meta) {
  if (!meta?.expiresAt) return true;
  return Date.now() >= meta.expiresAt;
}

async function saveSession(storageState, keyCookies) {
  await mkdir(dirname(ANONYMOUS_STATE_PATH), { recursive: true });

  const meta = {
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + config.sessionTtlMs,
    keyCookies: Object.keys(keyCookies),
    cookieCount: storageState.cookies?.length ?? 0,
  };

  await writeFile(ANONYMOUS_STATE_PATH, JSON.stringify(storageState, null, 2), 'utf-8');
  await writeFile(ANONYMOUS_META_PATH, JSON.stringify(meta, null, 2), 'utf-8');

  return { storageState, meta, keyCookies };
}

/**
 * Bootstrap de sessão anônima via warm-up no TikTok Shop (sem login).
 */
export async function bootstrapAnonymousSession(options = {}) {
  const region = config.region.toLowerCase();
  const warmupUrl = `https://www.tiktok.com/shop?region=${region}`;

  const browserSession = await openBrowserSession(options);

  try {
    const { page, close } = browserSession;
    const context = browserSession.context;

    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2500);

    await warmUpSession(page, { warmupUrl, warmupDelayMs: 3500 });

    const storageState = await context.storageState();
    const keyCookies = extractKeyCookies(storageState);

    if (!hasMinimumCookies(keyCookies)) {
      throw new Error('Sessão anônima incompleta — msToken/ttwid não gerados');
    }

    return saveSession(storageState, keyCookies);
  } finally {
    await browserSession.close();
  }
}

/**
 * Retorna sessão anônima válida; refresh automático se expirada.
 */
export async function getOrRefreshAnonymousSession(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const meta = await readMeta();
  const storageState = await readStorageState();

  if (!forceRefresh && storageState && meta && !isExpired(meta)) {
    const keyCookies = extractKeyCookies(storageState);
    if (hasMinimumCookies(keyCookies)) {
      return {
        storageState,
        meta,
        keyCookies,
        refreshed: false,
      };
    }
  }

  const bootstrapped = await bootstrapAnonymousSession(options);
  return {
    ...bootstrapped,
    refreshed: true,
  };
}

/**
 * Monta header Cookie a partir da sessão anônima.
 */
export function buildCookieHeader(storageState) {
  if (!storageState?.cookies?.length) return null;
  return storageState.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function getSessionSummary(session) {
  return {
    refreshed: session.refreshed,
    expiresAt: session.meta?.expiresAt
      ? new Date(session.meta.expiresAt).toISOString()
      : null,
    cookies: session.keyCookies ? Object.keys(session.keyCookies) : [],
  };
}

/**
 * Persiste storage state após captcha resolvido manualmente.
 */
export async function persistStorageState(storageState) {
  const keyCookies = extractKeyCookies(storageState);
  return saveSession(storageState, keyCookies);
}
