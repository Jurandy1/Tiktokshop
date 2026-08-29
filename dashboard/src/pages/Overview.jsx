import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCounts, fetchNewProductsCount, fetchRecentRuns, fetchTopViral } from '../lib/products';
import { fetchTopViralVideos, fetchVideoCount } from '../lib/videos';
import ProductCard from '../components/ProductCard';
import VideoCard from '../components/VideoCard';

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

  if (loading) return <div className="loading">…</div>;

  return (
    <>
      {error && <div className="error-box">{error}</div>}

      <div className="stats">
        <div className="stat">
          <div className="label">Produtos monitorados</div>
          <div className="value">{fmt(counts.products)}</div>
        </div>
        <div className="stat">
          <div className="label">Novos produtos (24h)</div>
          <div className="value">{fmt(newProducts)}</div>
        </div>
        <div className="stat">
          <div className="label">Vídeos com produto</div>
          <div className="value">{fmt(videoCount)}</div>
        </div>
        <div className="stat">
          <div className="label">Última atualização</div>
          <div className="value small">
            {lastRun?.startedAt ? new Date(lastRun.startedAt).toLocaleString('pt-BR') : '—'}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Produtos em destaque</h2>
          <Link to="/produtos" className="muted small">Ver todos →</Link>
        </div>
        {topProducts.length === 0 ? (
          <p className="muted">Nenhum produto ainda.</p>
        ) : (
          <div className="pgrid">
            {topProducts.map((p, i) => (
              <ProductCard key={p.id} product={p} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Vídeos em destaque</h2>
          <Link to="/videos" className="muted small">Ver todos →</Link>
        </div>
        {topVideos.length === 0 ? (
          <p className="muted">Nenhum vídeo ainda.</p>
        ) : (
          <div className="pgrid">
            {topVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
