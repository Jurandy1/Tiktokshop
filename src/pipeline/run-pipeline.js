import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectHashtags } from '../collectors/content-collector.js';
import { collectProducts } from '../collectors/product-collector.js';
import { isFirebaseConfigured, saveProductsToFirebase } from '../db/firebase.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../../output');

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function saveJson(filename, data) {
  await ensureOutputDir();
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return filepath;
}

/**
 * Pipeline completo: Fase 1 → Fase 2 → JSON local (+ Firebase opcional).
 */
export async function runPipeline(options = {}) {
  const hashtags = options.hashtags ?? config.defaultHashtags;
  const saveToFirebase = options.saveToFirebase ?? false;
  const usePlaywright = options.usePlaywright ?? true;

  console.log(`\n🚀 Iniciando pipeline — ${hashtags.length} hashtag(s)\n`);

  // Fase 1
  console.log('📹 Fase 1: Coletando vídeos por hashtag...');
  const contentResult = await collectHashtags(hashtags, options);
  const contentPath = await saveJson(
    `content-${Date.now()}.json`,
    contentResult
  );
  console.log(`   ✓ ${contentResult.summary.totalVideos} vídeos, ${contentResult.summary.uniqueProductIds} productIds`);
  console.log(`   → ${contentPath}\n`);

  // Fase 2
  const productIds = contentResult.productIds;
  let productResult = { products: [], summary: { totalProducts: 0, successfulProducts: 0 } };

  if (productIds.length > 0) {
    console.log(`🛒 Fase 2: Coletando ${productIds.length} produto(s)...`);
    productResult = await collectProducts(productIds, { ...options, usePlaywright });
    const productPath = await saveJson(`products-${Date.now()}.json`, productResult);
    console.log(`   ✓ ${productResult.summary.successfulProducts}/${productResult.summary.totalProducts} produtos`);
    console.log(`   → ${productPath}\n`);

    if (saveToFirebase && productResult.products.length > 0 && isFirebaseConfigured()) {
      const saved = await saveProductsToFirebase(productResult.products, { source: 'pipeline' });
      console.log(`   🔥 Firebase: ${saved.savedIds.length} produto(s) em "${saved.collection}"\n`);
    }
  } else {
    console.log('🛒 Fase 2: Nenhum productId encontrado — pulando coleta de produtos\n');
  }

  const result = {
    content: contentResult,
    products: productResult,
  };

  await saveJson(`pipeline-${Date.now()}.json`, result);

  console.log('✅ Pipeline concluído\n');
  return result;
}
