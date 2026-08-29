/**
 * Motor de descoberta de queries de PRODUTO — determinístico, sem IA/LLM.
 *
 * Só existem 2 fontes nesta primeira versão, ambas campos reais já
 * persistidos no Firestore (não em memória, não inventados):
 *   1. categoria do produto (products/{id}.category)
 *   2. título do produto (products/{id}.title)
 *
 * Hashtag de vídeo ficou de fora — só existiria em memória durante
 * runVideoSync e decidimos não persistir campo novo só pra viabilizar isso
 * nem alterar o contrato dessa função. Pode virar v2 se um dia fizer sentido.
 *
 * Discovery lê o Firestore (nunca a coleção inteira, sempre limitado) e
 * nunca toca em sync-core.js/video-core.js. `lastSeenAt` (já existente, já
 * indexado, mesmo campo que dashboard/src/lib/products.js já usa) é uma
 * aproximação de "produtos tocados recentemente" — não uma garantia exata
 * de pertencer a uma execução específica.
 *
 * `priority` é só uma heurística interna pra ordenar a fila de execução.
 * NUNCA é uma métrica de produto, nunca aparece em nenhuma tela do
 * dashboard.
 *
 * Regra inegociável: uma candidata nunca roda no mesmo ciclo em que foi
 * descoberta. Isso é garantido pela ORDEM das chamadas em scheduled-sync.js
 * (seleciona e roda o lote da fila ANTES de minerar candidatas novas) — não
 * por comparação de timestamp.
 */

// ---- Limites, todos aqui, fáceis de ajustar ----
export const MAX_NEW_QUERIES_PER_CYCLE = 3;
export const DISCOVERY_BATCH_SIZE = 2;
export const DISCOVERY_COOLDOWN_HOURS = 72;
export const MAX_QUEUE_SIZE = 200;
export const RECENT_WINDOW_LIMIT = 100;
export const MIN_TOKEN_LENGTH = 4;

const STOPWORDS_PT = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'e', 'ou', 'o', 'a', 'os', 'as',
  'por', 'pra', 'pro', 'que', 'ao', 'aos', 'seu', 'sua', 'seus', 'suas',
  'kit', 'kits', 'original', 'novo', 'nova', 'promocao', 'promoção',
  'oferta', 'frete', 'gratis', 'grátis', 'envio', 'imediato', 'unidade',
  'unidades',
]);

const SIZE_COLOR_WORDS = new Set([
  'p', 'm', 'g', 'gg', 'pp', 'xg', 'xgg',
  'branco', 'branca', 'preto', 'preta', 'azul', 'vermelho', 'vermelha',
  'verde', 'rosa', 'amarelo', 'amarela', 'cinza', 'bege', 'roxo', 'roxa',
  'laranja', 'marrom', 'dourado', 'dourada', 'prateado', 'prata',
]);

const MEASURE_RE = /^\d+([.,]\d+)?(ml|l|kg|g|cm|mm|m|un|unid|pç|pçs|pc|pcs)?$/i;

const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeForComparison(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .trim();
}

function isUsableToken(token) {
  if (token.length < MIN_TOKEN_LENGTH) return false;
  if (STOPWORDS_PT.has(token)) return false;
  if (SIZE_COLOR_WORDS.has(token)) return false;
  if (MEASURE_RE.test(token)) return false;
  if (/^\d+$/.test(token)) return false;
  return true;
}

/**
 * No máximo UMA frase de 2 palavras adjacentes e significativas por título
 * (a primeira encontrada) — nunca palavra isolada, e nunca várias frases do
 * mesmo título, pra não multiplicar a fila com termos genéricos.
 */
export function extractTitlePhrases(title) {
  if (!title) return [];
  const raw = String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const usableIndexes = [];
  for (let i = 0; i < raw.length; i++) {
    if (isUsableToken(normalizeForComparison(raw[i]))) usableIndexes.push(i);
  }

  for (let i = 0; i < usableIndexes.length - 1; i++) {
    const a = usableIndexes[i];
    const b = usableIndexes[i + 1];
    if (b - a <= 2) return [`${raw[a]} ${raw[b]}`.trim()];
  }
  return [];
}

/** category_breadcrumb já vem como [{category_id, category_name, level}]. */
export function extractCategoryNames(category) {
  if (!Array.isArray(category)) return [];
  return category.map((c) => c?.category_name).filter(Boolean);
}

/** Heurística simples e documentada — nunca exibida ao usuário. */
export function computePriority({ hasSales = false, hasVideo = false } = {}) {
  let score = 1;
  if (hasSales) score += 2;
  if (hasVideo) score += 5;
  return score;
}

/**
 * Lê uma janela pequena de produtos recentes e mina candidatas conservadoras.
 * Não grava nada — só retorna a lista de candidatas em memória.
 */
export async function mineProductCandidates(firestore) {
  const snap = await firestore
    .collection('products')
    .orderBy('lastSeenAt', 'desc')
    .limit(RECENT_WINDOW_LIMIT)
    .get();

  const candidates = new Map(); // query normalizada -> { query, source, priority }

  snap.docs.forEach((doc) => {
    const p = doc.data();
    const priority = computePriority({
      hasSales: Number(p.lastSoldCount || 0) > 0,
      hasVideo: Boolean(p.hasVideo),
    });

    extractCategoryNames(p.category).forEach((name) => {
      const key = normalizeForComparison(name);
      if (!key) return;
      const existing = candidates.get(key);
      if (!existing || priority > existing.priority) {
        candidates.set(key, { query: name, source: 'category', priority });
      }
    });

    extractTitlePhrases(p.title).forEach((phrase) => {
      const key = normalizeForComparison(phrase);
      if (!key) return;
      const existing = candidates.get(key);
      if (!existing || priority > existing.priority) {
        candidates.set(key, { query: phrase, source: 'title_phrase', priority });
      }
    });
  });

  return [...candidates.values()].sort((a, b) => b.priority - a.priority);
}

/**
 * Grava candidatas novas em search_queue, respeitando o limite por ciclo,
 * o tamanho máximo da fila, e sem duplicar sementes/itens já na fila.
 */
export async function enqueueCandidates(firestore, candidates, seeds = []) {
  if (!candidates.length) return { enqueued: 0 };

  const seedKeys = new Set(seeds.map(normalizeForComparison));

  const existingSnap = await firestore.collection('search_queue').get();
  const existingKeys = new Set(
    existingSnap.docs.map((d) => normalizeForComparison(d.data().query))
  );

  if (existingSnap.size >= MAX_QUEUE_SIZE) {
    return { enqueued: 0, skipped: 'fila cheia' };
  }

  const room = MAX_QUEUE_SIZE - existingSnap.size;
  const toAdd = candidates
    .filter((c) => {
      const key = normalizeForComparison(c.query);
      return key && !seedKeys.has(key) && !existingKeys.has(key);
    })
    .slice(0, Math.min(MAX_NEW_QUERIES_PER_CYCLE, room));

  const batch = firestore.batch();
  for (const c of toAdd) {
    const ref = firestore.collection('search_queue').doc();
    batch.set(ref, {
      query: c.query,
      source: c.source,
      priority: c.priority,
      status: 'idle',
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      resultCount: null,
    });
  }
  if (toAdd.length) await batch.commit();

  return { enqueued: toAdd.length };
}

/**
 * Seleciona um lote pequeno já priorizado de itens 'idle'/'done' fora do
 * cooldown — nunca itens gravados neste mesmo ciclo (garantido pela ordem
 * das chamadas em scheduled-sync.js, não por esta função).
 */
export async function pickNextBatch(firestore) {
  const cooldownCutoff = new Date(Date.now() - DISCOVERY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  const snap = await firestore
    .collection('search_queue')
    .orderBy('priority', 'desc')
    .limit(DISCOVERY_BATCH_SIZE * 5) // margem pra filtrar cooldown em memória sem índice composto novo
    .get();

  const picked = snap.docs
    .filter((d) => {
      const data = d.data();
      if (data.status === 'queued' || data.status === 'running') return false;
      if (!data.lastRunAt) return true;
      return data.lastRunAt < cooldownCutoff;
    })
    .slice(0, DISCOVERY_BATCH_SIZE);

  if (!picked.length) return [];

  const batch = firestore.batch();
  picked.forEach((d) => batch.update(d.ref, { status: 'queued' }));
  await batch.commit();

  return picked.map((d) => ({ id: d.id, query: d.data().query }));
}

/**
 * Depois de rodar o lote via runSync, marca cada item como concluído e
 * preenche resultCount lendo o doc runs/{runId} que o próprio runSync já
 * grava (via saveRun) — sem precisar mudar nada em sync-core.js.
 */
export async function markBatchExecuted(firestore, batchItems, runId) {
  if (!batchItems.length) return;

  let perQuery = [];
  try {
    const runDoc = await firestore.collection('runs').doc(runId).get();
    perQuery = runDoc.data()?.perQuery || [];
  } catch {
    // segue sem resultCount se não conseguir ler a run
  }

  const countByQuery = new Map(perQuery.map((p) => [normalizeForComparison(p.query), p.count ?? null]));
  const nowIso = new Date().toISOString();

  const batch = firestore.batch();
  for (const item of batchItems) {
    const ref = firestore.collection('search_queue').doc(item.id);
    batch.update(ref, {
      status: 'done',
      lastRunAt: nowIso,
      resultCount: countByQuery.get(normalizeForComparison(item.query)) ?? null,
    });
  }
  await batch.commit();
}
