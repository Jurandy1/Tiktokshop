import { config } from '../config.js';

export function buildChallengeItemListUrl(challengeId, cursor = 0, count = 30) {
  const params = new URLSearchParams({
    aid: '1988',
    app_language: 'pt-BR',
    app_name: 'tiktok_web',
    browser_language: 'pt-BR',
    browser_name: 'Mozilla',
    browser_online: 'true',
    browser_platform: 'Win32',
    browser_version: '5.0',
    challengeID: String(challengeId),
    channel: 'tiktok_web',
    cookie_enabled: 'true',
    count: String(count),
    cursor: String(cursor),
    device_platform: 'web_mobile',
    focus_state: 'true',
    from_page: 'hashtag',
    history_len: '3',
    is_fullscreen: 'false',
    is_page_visible: 'true',
    language: 'pt-BR',
    os: 'android',
    region: config.region.toUpperCase(),
    screen_height: '844',
    screen_width: '390',
    tz_name: 'America/Sao_Paulo',
    webcast_language: 'pt-BR',
  });

  return `https://www.tiktok.com/api/challenge/item_list/?${params}`;
}

export function buildProductApiUrl(productId) {
  const params = new URLSearchParams({
    product_id: String(productId),
    region: config.region.toUpperCase(),
  });
  return `https://www.tiktok.com/api/shop/product/detail/?${params}`;
}
