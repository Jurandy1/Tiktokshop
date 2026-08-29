import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { runSync } from './sync-core.js';

const scrapeCreatorsKey = defineSecret('SCRAPECREATORS_API_KEY');

/**
 * Substitui src/watcher.js: dispara quando o dashboard cria um doc em
 * scrape_requests/{id} ("Coletar agora"). Roda a coleta na hora, sem
 * depender de nenhum processo local rodando no PC.
 *
 * enrich > 0 (via CDP/Chrome local) não existe em produção — o pedido é
 * marcado como erro com uma mensagem clara em vez de tentar e travar.
 */
export const onScrapeRequest = onDocumentCreated(
  {
    document: 'scrape_requests/{requestId}',
    region: 'southamerica-east1',
    secrets: [scrapeCreatorsKey],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const ref = snap.ref;

    if (Number(data.enrich) > 0) {
      await ref.update({
        status: 'error',
        error: 'Enriquecimento via Chrome local não está disponível em produção (só no PC, via npm run watcher).',
        finishedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    await ref.update({ status: 'running', startedAt: FieldValue.serverTimestamp() });

    try {
      const queries = Array.isArray(data.queries) && data.queries.length ? data.queries : undefined;
      const result = await runSync({
        queries,
        runId: `run-req-${event.params.requestId}`,
        source: 'scrape_request',
      });

      await ref.update({
        status: result.ok ? 'done' : 'error',
        productsFound: result.productsFound,
        productsSaved: result.saved,
        finishedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await ref.update({
        status: 'error',
        error: err.message,
        finishedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);
