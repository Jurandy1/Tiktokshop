/**
 * Entry point para Cloud Function agendada (GCP, Vercel Cron, etc.)
 *
 * Configure as variáveis de ambiente e agende para rodar diariamente
 * ou a cada poucas horas.
 */
import { runPipeline } from '../pipeline/run-pipeline.js';

export async function handler(req, res) {
  try {
    const hashtags = req?.body?.hashtags || req?.query?.hashtags?.split(',');
    const result = await runPipeline({ hashtags, saveToDb: true });

    const response = {
      success: true,
      runId: result.runId,
      summary: {
        videos: result.content.summary,
        products: result.products.summary,
      },
    };

    if (res) {
      res.status(200).json(response);
    }
    return response;
  } catch (error) {
    const response = { success: false, error: error.message };
    if (res) {
      res.status(500).json(response);
    }
    throw error;
  }
}

// Execução direta: node src/cloud-function.js
if (process.argv[1]?.endsWith('cloud-function.js')) {
  handler().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
