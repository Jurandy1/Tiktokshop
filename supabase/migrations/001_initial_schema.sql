-- Schema inicial para o extrator TikTok / TikTok Shop
-- Rode no Supabase SQL Editor ou via CLI

-- Execuções de coleta (cron / pipeline)
CREATE TABLE IF NOT EXISTS collection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  metadata JSONB DEFAULT '{}',
  summary JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Snapshots de vídeos (Fase 1)
CREATE TABLE IF NOT EXISTS tiktok_videos (
  id BIGSERIAL PRIMARY KEY,
  collection_run_id UUID REFERENCES collection_runs(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  hashtag TEXT,
  description TEXT,
  author_unique_id TEXT,
  author_nickname TEXT,
  play_count BIGINT DEFAULT 0,
  digg_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  share_count BIGINT DEFAULT 0,
  collect_count BIGINT DEFAULT 0,
  product_id TEXT,
  video_url TEXT,
  cover_url TEXT,
  created_at_video TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_video_id ON tiktok_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_hashtag ON tiktok_videos(hashtag);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_product_id ON tiktok_videos(product_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_scraped_at ON tiktok_videos(scraped_at DESC);

-- Snapshots de produtos (Fase 2)
CREATE TABLE IF NOT EXISTS tiktok_products (
  id BIGSERIAL PRIMARY KEY,
  collection_run_id UUID REFERENCES collection_runs(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  price NUMERIC(12, 2),
  original_price NUMERIC(12, 2),
  discount_pct INTEGER,
  currency TEXT DEFAULT 'BRL',
  sold_count BIGINT DEFAULT 0,
  stock BIGINT DEFAULT 0,
  rating NUMERIC(3, 2),
  rating_count BIGINT DEFAULT 0,
  rating_distribution JSONB,
  images JSONB DEFAULT '[]',
  skus JSONB DEFAULT '[]',
  shop_id TEXT,
  shop_name TEXT,
  shop_followers TEXT,
  shop_total_sold TEXT,
  product_url TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_products_product_id ON tiktok_products(product_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_products_scraped_at ON tiktok_products(scraped_at DESC);

-- View: delta de sold_count entre coletas (proxy de "vendendo bem agora")
CREATE OR REPLACE VIEW tiktok_products_daily_diff AS
WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at DESC) AS rn,
    LAG(sold_count) OVER (PARTITION BY product_id ORDER BY scraped_at) AS prev_sold_count,
    LAG(scraped_at) OVER (PARTITION BY product_id ORDER BY scraped_at) AS prev_scraped_at
  FROM tiktok_products
)
SELECT
  product_id,
  title,
  price,
  sold_count,
  prev_sold_count,
  (sold_count - COALESCE(prev_sold_count, sold_count)) AS sold_delta,
  scraped_at AS latest_scraped_at,
  prev_scraped_at,
  shop_name,
  rating,
  product_url
FROM ranked
WHERE rn = 1
  AND prev_sold_count IS NOT NULL
ORDER BY sold_delta DESC;

-- View: crescimento de views por vídeo
CREATE OR REPLACE VIEW tiktok_videos_growth AS
WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY scraped_at DESC) AS rn,
    LAG(play_count) OVER (PARTITION BY video_id ORDER BY scraped_at) AS prev_play_count,
    LAG(digg_count) OVER (PARTITION BY video_id ORDER BY scraped_at) AS prev_digg_count
  FROM tiktok_videos
)
SELECT
  video_id,
  hashtag,
  author_unique_id,
  author_nickname,
  play_count,
  prev_play_count,
  (play_count - COALESCE(prev_play_count, play_count)) AS play_delta,
  digg_count,
  prev_digg_count,
  (digg_count - COALESCE(prev_digg_count, digg_count)) AS digg_delta,
  product_id,
  video_url,
  scraped_at AS latest_scraped_at
FROM ranked
WHERE rn = 1
  AND prev_play_count IS NOT NULL
ORDER BY play_delta DESC;

-- RLS: desabilitado por padrão (dashboard usa service role ou anon com policies)
ALTER TABLE collection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_products ENABLE ROW LEVEL SECURITY;

-- Policy de leitura pública para o dashboard (ajuste conforme necessário)
CREATE POLICY "Leitura pública de vídeos" ON tiktok_videos FOR SELECT USING (true);
CREATE POLICY "Leitura pública de produtos" ON tiktok_products FOR SELECT USING (true);
CREATE POLICY "Leitura pública de runs" ON collection_runs FOR SELECT USING (true);
