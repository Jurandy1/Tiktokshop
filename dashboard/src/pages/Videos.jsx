import { useEffect, useState } from 'react';
import { fetchTopViralVideos, fetchRecentVideos } from '../lib/videos';
import VideoCard from '../components/VideoCard';

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
      <div className="stats">
        <div className="stat">
          <div className="label">{onlyWithProduct ? 'Vídeos virais com produto' : 'Vídeos coletados'}</div>
          <div className="value">{videos.length}</div>
        </div>
        <div className="stat action-stat">
          <button className="btn ghost" onClick={() => load(onlyWithProduct)} disabled={loading}>
            {loading ? '…' : '↻ Recarregar'}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="filters">
          <label className="filter-group">
            <input
              type="checkbox"
              checked={onlyWithProduct}
              onChange={(e) => setOnlyWithProduct(e.target.checked)}
            />
            {' '}Só vídeo viral com produto confirmado
          </label>
          <div className="filter-count muted small">{videos.length} vídeo(s)</div>
        </div>

        {videos.length === 0 ? (
          <p className="muted">
            {onlyWithProduct
              ? 'Nenhum vídeo com produto confirmado ainda — a coleta roda 1x/dia e só grava vídeo já ligado a um produto real do TikTok Shop.'
              : 'Nenhum vídeo coletado ainda.'}
          </p>
        ) : (
          <div className="pgrid">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
