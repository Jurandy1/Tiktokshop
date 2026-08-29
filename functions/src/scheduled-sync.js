import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { runSync, DEFAULT_QUERIES } from './sync-core.js';

const scrapeCreatorsKey = defineSecret('SCRAPECREATORS_API_KEY');

/**
 * Roda a cada 6h: busca produtos por palavra-chave no ScrapeCreators e grava
 * no Firestore. Cobre preço/mais-vendidos/melhores-avaliados — tudo já vem
 * no mesmo payload, só precisa ordenar (ver dashboard/src/lib/products.js).
 *
 * Custo aproximado: 2 queries × 4 execuções/dia = 8 créditos ScrapeCreators/dia.
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
  }
);
