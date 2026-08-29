import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { runVideoSync, DEFAULT_VIDEO_HASHTAGS } from './video-core.js';

const scrapeCreatorsKey = defineSecret('SCRAPECREATORS_API_KEY');

/**
 * Roda 1x/dia: busca vídeos por hashtag no ScrapeCreators, mantém só os que
 * têm produto confirmado no catálogo (products/{id}) e grava em videos/{id},
 * já com viralScore calculado. Ver functions/src/video-core.js pro porquê de
 * não usar mais o coletor headless próprio (video-collector-service/, hoje
 * sem uso — o TikTok parou de servir vídeo de hashtag pra sessão anônima).
 */
export const scheduledVideoSync = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    secrets: [scrapeCreatorsKey],
    timeoutSeconds: 180,
    memory: '256MiB',
  },
  async () => {
    await runVideoSync({
      hashtags: DEFAULT_VIDEO_HASHTAGS,
      source: 'scheduled',
    });
  }
);
