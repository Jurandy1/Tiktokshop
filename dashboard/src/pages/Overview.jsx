import { useEffect, useState } from 'react';
import { Sparkles, PlayCircle } from 'lucide-react';
import { fetchCounts, fetchNewProductsCount, fetchRecentRuns, fetchTopViral } from '../lib/products';
import { fetchTopViralVideos, fetchVideoCount } from '../lib/videos';
import ProductCard from '../components/ProductCard';
import VideoCard from '../components/VideoCard';
import MetricCard from '../components/MetricCard';
import SectionHeader from '../components/SectionHeader';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function Overview() {
  const [counts, setCounts] = useState({ products: 0 });
  const [newProducts, setNewProducts] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [lastRun, setLastRun] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [topVideos, setTopVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, novos, vCount, runs, produtos, videos] = await Promise.all([
          fetchCounts(),
          fetchNewProductsCount(24),
          fetchVideoCount(),
          fetchRecentRuns(1),
          fetchTopViral(8),
          fetchTopViralVideos(8),
        ]);
        setCounts(c);
        setNewProducts(novos);
        setVideoCount(vCount);
        setLastRun(runs[0] || null);
        setTopProducts(produtos);
        setTopVideos(videos);
        setError(null);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="text-center py-20 text-tiktok-muted">Carregando…</div>;
  }

  const lastUpdate = lastRun?.startedAt ? new Date(lastRun.startedAt) : null;

  return (
    <>
      {error && (
        <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Produtos monitorados" value={fmt(counts.products)} />
        <MetricCard label="Novos produtos (24h)" value={fmt(newProducts)} />
        <MetricCard label="Vídeos com produto" value={fmt(videoCount)} accent="pink" />
        <MetricCard label="Última atualização">
          <p className="text-base md:text-lg font-semibold font-mono tracking-tight text-white">
            {lastUpdate ? lastUpdate.toLocaleDateString('pt-BR') : '—'}
          </p>
          <p className="text-xs md:text-sm text-tiktok-muted font-mono">
            {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR') : ''}
          </p>
        </MetricCard>
      </div>

      <section className="space-y-4">
        <SectionHeader icon={Sparkles} title="Produtos em destaque" to="/produtos" />
        {topProducts.length === 0 ? (
          <p className="text-tiktok-muted">Nenhum produto ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
            {topProducts.map((p, i) => (
              <ProductCard key={p.id} product={p} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 pb-10">
        <SectionHeader icon={PlayCircle} iconColor="text-tiktok-pink" title="Vídeos em destaque" to="/videos" />
        {topVideos.length === 0 ? (
          <p className="text-tiktok-muted">Nenhum vídeo ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
            {topVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
