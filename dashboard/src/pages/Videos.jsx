import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchTopViralVideos, fetchRecentVideos } from '../lib/videos';
import VideoCard from '../components/VideoCard';
import MetricCard from '../components/MetricCard';

export default function Videos() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [onlyWithProduct, setOnlyWithProduct] = useState(true);

  async function load(withProduct) {
    setLoading(true);
    try {
      const v = withProduct ? await fetchTopViralVideos(60) : await fetchRecentVideos(90);
      setVideos(v);
      setError(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(onlyWithProduct);
  }, [onlyWithProduct]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={onlyWithProduct ? 'Vídeos virais com produto' : 'Vídeos coletados'}
          value={videos.length}
          accent="pink"
        />
        <MetricCard label="Atualizar">
          <button
            type="button"
            onClick={() => load(onlyWithProduct)}
            disabled={loading}
            className="flex items-center gap-2 text-sm font-medium text-tiktok-cyan hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Carregando…' : 'Recarregar'}
          </button>
        </MetricCard>
      </div>

      {error && (
        <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-tiktok-border">
          <label className="flex items-center gap-2 text-sm text-tiktok-muted cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithProduct}
              onChange={(e) => setOnlyWithProduct(e.target.checked)}
              className="rounded border-tiktok-border bg-black/50 text-tiktok-cyan focus:ring-tiktok-cyan"
            />
            Só vídeo viral com produto confirmado
          </label>
          <span className="text-sm text-tiktok-muted">{videos.length} vídeo(s)</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-tiktok-muted">Carregando…</div>
        ) : videos.length === 0 ? (
          <p className="text-tiktok-muted">
            {onlyWithProduct
              ? 'Nenhum vídeo com produto confirmado ainda — a coleta roda 1x/dia e só grava vídeo já ligado a um produto real do TikTok Shop.'
              : 'Nenhum vídeo coletado ainda.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-5">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
