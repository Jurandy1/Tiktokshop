import 'dotenv/config';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

export const config = {
  region: process.env.TIKTOK_REGION || 'br',
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS) || 5000,
  maxVideosPerHashtag: Number(process.env.MAX_VIDEOS_PER_HASHTAG) || 30,
  maxConcurrency: Number(process.env.MAX_CONCURRENCY) || 1,
  sessionTtlMs: Number(process.env.SESSION_TTL_MS) || 45 * 60 * 1000,
  signedUrlTtlMs: Number(process.env.SIGNED_URL_TTL_MS) || 5 * 60 * 1000,
  useStealth: process.env.USE_STEALTH !== 'false',
  proxyUrl: process.env.PROXY_URL || null,
  defaultHashtags: (process.env.DEFAULT_HASHTAGS || 'tiktokshop,achadinhos')
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean),
  cookiesPath:
    process.env.TIKTOK_COOKIES_PATH ||
    (existsSync(join(ROOT, 'cookies/tiktok-state.json'))
      ? join(ROOT, 'cookies/tiktok-state.json')
      : null),
  firebase: {
    serviceAccountPath:
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      (existsSync('c:\\Users\\PC\\Desktop\\Afiliadoteste-main\\functions\\serviceAccountKey.json')
        ? 'c:\\Users\\PC\\Desktop\\Afiliadoteste-main\\functions\\serviceAccountKey.json'
        : null),
    collection: process.env.FIREBASE_TIKTOK_COLLECTION || 'tiktok_shop_products',
    runsCollection: process.env.FIREBASE_TIKTOK_RUNS_COLLECTION || 'tiktok_discovery_runs',
  },
  supabase: {
    url: process.env.SUPABASE_URL || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  },
};

export const TIKTOK_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeHashtag(tag) {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

export function productUrl(productId, region = config.region) {
  const id = extractProductId(productId);
  const r = region.toLowerCase();
  return `https://shop.tiktok.com/${r}/pdp/${id}`;
}

export function productUrlLegacy(productId, region = config.region) {
  return `https://www.tiktok.com/view/product/${extractProductId(productId)}?region=${region}`;
}

export function extractProductId(input) {
  const value = String(input).trim();
  if (/^\d{15,20}$/.test(value)) return value;

  // shop.tiktok.com/br/pdp/1734150389017314840
  const pdpMatch = value.match(/\/pdp\/(\d{15,20})/i);
  if (pdpMatch) return pdpMatch[1];

  const match = value.match(/(\d{15,20})/);
  return match ? match[1] : value;
}

export function resolveProductInput(input) {
  const value = String(input).trim();
  const productId = extractProductId(value);
  const url = value.startsWith('http') ? value.split('?')[0] : productUrl(productId);
  return { productId, url };
}

/** Garante URL string — a API do Shop às vezes manda seo_url como objeto */
export function coerceProductUrl(value, productId) {
  if (typeof value === 'string' && value.includes('http')) {
    return value.split('?')[0];
  }
  if (value && typeof value === 'object') {
    for (const key of ['url', 'canonical_url', 'seo_url', 'href', 'link', 'path']) {
      const nested = value[key];
      if (typeof nested === 'string' && nested.includes('http')) {
        return nested.split('?')[0];
      }
    }
  }
  return productUrl(extractProductId(productId));
}
