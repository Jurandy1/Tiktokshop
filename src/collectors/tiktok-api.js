import { config, normalizeHashtag, TIKTOK_HEADERS } from '../config.js';
import { buildChallengeItemListUrl } from './tiktok-api-params.js';
import { fetchWithAnonymousSession } from '../session/url-signer.js';
import { getOrRefreshAnonymousSession, buildCookieHeader } from '../session/anonymous-session.js';

/**
 * Busca metadados da hashtag via API pública (não requer assinatura).
 */
export async function fetchChallengeDetail(hashtag, session = null) {
  const normalized = normalizeHashtag(hashtag);
  const url = `https://www.tiktok.com/api/challenge/detail/?challengeName=${encodeURIComponent(normalized)}`;

  const cookieHeader = session ? buildCookieHeader(session.storageState) : null;

  const response = await fetch(url, {
    headers: {
      ...TIKTOK_HEADERS,
      Referer: 'https://www.tiktok.com/',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao buscar challenge detail para #${normalized}`);
  }

  const data = await response.json();
  const challenge = data?.challengeInfo?.challenge;

  if (!challenge?.id) {
    throw new Error(`Hashtag #${normalized} não encontrada`);
  }

  return {
    challengeId: String(challenge.id),
    title: challenge.title,
    stats: challenge.stats,
    isCommerce: challenge.isCommerce,
  };
}

/**
 * Busca vídeos via API com sessão anônima (cookies + signer se necessário).
 */
export async function fetchChallengeItemList(challengeId, cursor = 0, count = 30, session = null) {
  const activeSession = session ?? (await getOrRefreshAnonymousSession());
  const apiUrl = buildChallengeItemListUrl(challengeId, cursor, count);

  const result = await fetchWithAnonymousSession(apiUrl, activeSession.storageState, {
    referer: `https://www.tiktok.com/tag/`,
    triggerUrl: `https://www.tiktok.com/tag/`,
  });

  if (!result.data) {
    return { itemList: [], cursor: 0, hasMore: false, needsSigning: true, source: result.source };
  }

  return {
    itemList: result.data.itemList || [],
    cursor: result.data.cursor ?? cursor,
    hasMore: Boolean(result.data.hasMore),
    needsSigning: false,
    source: result.source,
  };
}

/**
 * Busca item_list via captura de rede no browser (fallback robusto).
 */
export async function fetchChallengeItemListViaBrowser(challengeName, maxVideos = 30, options = {}) {
  const { launchStealthBrowser, createStealthContext, warmUpSession, attachNetworkCapture } =
    await import('../browser/stealth-context.js');
  const { getOrRefreshAnonymousSession } = await import('../session/anonymous-session.js');

  const normalized = normalizeHashtag(challengeName);
  const url = `https://www.tiktok.com/tag/${encodeURIComponent(normalized)}`;
  const session = await getOrRefreshAnonymousSession(options);
  const capturedItems = [];

  const { browser } = await launchStealthBrowser(options);

  try {
    const context = await createStealthContext(browser, {
      storageState: session.storageState,
    });
    const page = await context.newPage();

    attachNetworkCapture(page);

    page.on('response', async (response) => {
      if (!response.url().includes('item_list')) return;
      try {
        const json = await response.json();
        if (json.itemList?.length) capturedItems.push(...json.itemList);
      } catch {
        // ignore
      }
    });

    await warmUpSession(page, { warmupDelayMs: 2000 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(3500);

    for (let i = 0; i < 6 && capturedItems.length < maxVideos; i++) {
      await page.evaluate(() => window.scrollBy(0, 900));
      await page.waitForTimeout(1800);
    }

    return {
      itemList: capturedItems.slice(0, maxVideos),
      source: 'anonymous-session-browser',
      sessionSummary: session.meta,
    };
  } finally {
    await browser.close();
  }
}
