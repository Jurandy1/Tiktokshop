import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { runSync, DEFAULT_QUERIES } from './sync-core.js';
import { initFirebase } from './firebase.js';
import { mineProductCandidates, enqueueCandidates, pickNextBatch, markBatchExecuted } from './discovery-core.js';

const scrapeCreatorsKey = defineSecret('SCRAPECREATORS_API_KEY');

/**
 * Roda a cada 6h: busca produtos por palavra-chave no ScrapeCreators e grava
 * no Firestore. Cobre preço/mais-vendidos/melhores-avaliados — tudo já vem
 * no mesmo payload, só precisa ordenar (ver dashboard/src/lib/products.js).
 *
 * Custo aproximado: 2 queries seed × 4 execuções/dia = 8 créditos/dia, mais
 * até DISCOVERY_BATCH_SIZE créditos/execução do lote de descoberta.
 *
 * Ordem OBRIGATÓRIA dentro do ciclo (garante que uma query descoberta nunca
 * roda no mesmo ciclo em que foi criada — ver discovery-core.js):
 *   1. sementes (achadinhos/tiktokshop, sempre)
 *   2. seleciona e roda um lote da fila que já estava pendente de ciclos
 *      anteriores
 *   3. só então minera candidatas novas desta execução (ficam pro próximo
 *      ciclo escolher)
 */
export const scheduledSync = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    secrets: [scrapeCreatorsKey],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    await runSync({
      queries: DEFAULT_QUERIES,
      source: 'scheduled',
    });

    const firestore = await initFirebase();

    const batch = await pickNextBatch(firestore);
    if (batch.length) {
      const batchResult = await runSync({
        queries: batch.map((b) => b.query),
        source: 'discovery',
      });
      await markBatchExecuted(firestore, batch, batchResult.runId);
    }

    const candidates = await mineProductCandidates(firestore);
    await enqueueCandidates(firestore, candidates, DEFAULT_QUERIES);
  }
);
