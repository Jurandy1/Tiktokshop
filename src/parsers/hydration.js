import * as cheerio from 'cheerio';

const HYDRATION_SCRIPT_IDS = [
  '__UNIVERSAL_DATA_FOR_REHYDRATION__',
  'SIGI_STATE',
  '__NEXT_DATA__',
];

/**
 * Extrai o JSON embutido nas páginas do TikTok.
 * Isolado num módulo próprio para facilitar ajuste quando o TikTok mudar o layout.
 */
export function extractHydrationData(html) {
  const $ = cheerio.load(html);

  for (const scriptId of HYDRATION_SCRIPT_IDS) {
    const script = $(`script#${scriptId}`);
    if (!script.length) continue;

    const raw = script.html()?.trim();
    if (!raw || raw === '{}') continue;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && Object.keys(parsed).length > 0) {
        return { source: scriptId, data: parsed };
      }
    } catch {
      // tenta próximo formato
    }
  }

  // Fallback: varre scripts que parecem conter dados de vídeo/produto
  const scripts = $('script');
  for (let i = 0; i < scripts.length; i++) {
    const text = $(scripts[i]).html() || '';
    if (!text.includes('"stats"') && !text.includes('"soldCount"')) continue;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) continue;

    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === 'object') {
        return { source: 'script-scan', data: parsed };
      }
    } catch {
      // continua
    }
  }

  return null;
}

/**
 * Busca recursiva por chaves no JSON — útil quando o TikTok muda o caminho aninhado.
 */
export function deepFind(obj, predicate, maxDepth = 12, depth = 0) {
  if (!obj || depth > maxDepth) return undefined;

  if (predicate(obj)) return obj;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, predicate, maxDepth, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      const found = deepFind(value, predicate, maxDepth, depth + 1);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

export function deepFindAll(obj, predicate, maxDepth = 12, depth = 0, results = []) {
  if (!obj || depth > maxDepth) return results;

  if (predicate(obj)) results.push(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFindAll(item, predicate, maxDepth, depth + 1, results);
    }
    return results;
  }

  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      deepFindAll(value, predicate, maxDepth, depth + 1, results);
    }
  }

  return results;
}

export function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}
