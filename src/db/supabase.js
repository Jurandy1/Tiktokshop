import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client = null;

export function getSupabase() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar configurados no .env'
    );
  }

  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }

  return client;
}

export function isSupabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.serviceRoleKey);
}

/**
 * Grava snapshot de vídeos coletados na Fase 1.
 */
export async function saveVideoSnapshots(videos, collectionRunId) {
  const supabase = getSupabase();

  const rows = videos.map((video) => ({
    collection_run_id: collectionRunId,
    video_id: video.videoId,
    hashtag: video.hashtag,
    description: video.description,
    author_unique_id: video.author?.uniqueId,
    author_nickname: video.author?.nickname,
    play_count: video.stats.playCount,
    digg_count: video.stats.diggCount,
    comment_count: video.stats.commentCount,
    share_count: video.stats.shareCount,
    collect_count: video.stats.collectCount,
    product_id: video.productId,
    video_url: video.videoUrl,
    cover_url: video.coverUrl,
    created_at_video: video.createdAt,
    scraped_at: video.scrapedAt,
  }));

  const { data, error } = await supabase.from('tiktok_videos').insert(rows).select();
  if (error) throw new Error(`Erro ao salvar vídeos: ${error.message}`);
  return data;
}

/**
 * Grava snapshot de produtos coletados na Fase 2.
 */
export async function saveProductSnapshots(products, collectionRunId) {
  const supabase = getSupabase();

  const rows = products.map((product) => ({
    collection_run_id: collectionRunId,
    product_id: product.productId,
    title: product.title,
    description: product.description,
    price: product.price,
    original_price: product.originalPrice,
    discount_pct: product.discountPct,
    currency: product.currency,
    sold_count: product.soldCount,
    stock: product.stock,
    rating: product.rating,
    rating_count: product.ratingCount,
    rating_distribution: product.ratingDistribution,
    images: product.images,
    skus: product.skus,
    shop_id: product.shop?.shopId,
    shop_name: product.shop?.shopName,
    shop_followers: product.shop?.followers,
    shop_total_sold: product.shop?.totalSold,
    product_url: product.productUrl,
    scraped_at: product.scrapedAt,
  }));

  const { data, error } = await supabase.from('tiktok_products').insert(rows).select();
  if (error) throw new Error(`Erro ao salvar produtos: ${error.message}`);
  return data;
}

/**
 * Registra uma execução de coleta (para rastrear snapshots).
 */
export async function createCollectionRun(metadata = {}) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('collection_runs')
    .insert({
      status: 'running',
      metadata,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar collection_run: ${error.message}`);
  return data;
}

export async function finishCollectionRun(runId, status, summary = {}) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('collection_runs')
    .update({
      status,
      summary,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao finalizar collection_run: ${error.message}`);
  return data;
}
