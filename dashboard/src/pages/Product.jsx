import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProductDetail } from '../lib/products';
import { fetchVideosByProduct } from '../lib/videos';
import VideoCard from '../components/VideoCard';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** Sparkline SVG minimal — sem lib externa. */
function Sparkline({ values, width = 500, height = 80, color = '#f43f5e' }) {
  if (!values?.length) return <div className="muted">sem dados</div>;
  const nums = values.map((v) => Number(v) || 0);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const step = width / Math.max(1, nums.length - 1);
  const points = nums
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
      />
      <text x="0" y="12" fontSize="10" fill="#888">{min}</text>
      <text x={width - 40} y="12" fontSize="10" fill="#888">{max}</text>
    </svg>
  );
}

export default function Product() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProductDetail(id), fetchVideosByProduct(id)])
      .then(([p, v]) => {
        setProduct(p);
        setVideos(v);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <p>Carregando…</p>;
  if (error) return <div className="error-box">{error}</div>;
  if (!product) return <div className="error-box">Produto não encontrado.</div>;

  const soldSeries = (product.daily || []).map((d) => d.soldCountMax).filter((v) => v != null);
  const priceSeries = (product.daily || []).map((d) => d.priceLast).filter((v) => v != null);
  const lastSnap = product.snapshots?.[0];

  return (
    <>
      <p><Link to="/produtos">← voltar</Link></p>
      <div className="card">
        <div className="pdetail">
          {product.image && (
            <img src={product.image} alt="" className="pimg" />
          )}
          <div>
            <h2>{product.title || product.id}</h2>
            <div className="muted">
              {product.seller?.name && <>por {product.seller.name} · </>}
              productId: <code>{product.id}</code>
            </div>
            {product.pdpUrl && (
              <p>
                <a href={product.pdpUrl} target="_blank" rel="noreferrer">
                  abrir no TikTok Shop →
                </a>
              </p>
            )}

            <div className="stats-inline">
              <div><span className="label">Vendidos</span> <b>{fmt(lastSnap?.soldCount)}</b></div>
              <div><span className="label">Preço</span> <b>{lastSnap?.saleFormatted || lastSnap?.price || '—'}</b></div>
              <div><span className="label">Rating</span> <b>{lastSnap?.rating ?? '—'}★</b></div>
              <div><span className="label">Reviews</span> <b>{fmt(lastSnap?.reviewCount)}</b></div>
              <div><span className="label">Viral</span> <b>{fmt(lastSnap?.viralScore)}</b></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Vendas ao longo do tempo</h3>
          <Sparkline values={soldSeries} color="#22c55e" />
          <div className="muted small">{soldSeries.length} pontos (últimos {product.daily?.length || 0} dias)</div>
        </div>
        <div className="card">
          <h3>Preço ao longo do tempo</h3>
          <Sparkline values={priceSeries} color="#3b82f6" />
        </div>
      </div>

      <div className="card">
        <h3>Snapshots recentes ({product.snapshots?.length || 0})</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Capturado em</th>
              <th className="num">Preço</th>
              <th className="num">Vendidos</th>
              <th className="num">Rating</th>
              <th className="num">Viral</th>
            </tr>
          </thead>
          <tbody>
            {(product.snapshots || []).slice(0, 20).map((s) => (
              <tr key={s.id}>
                <td>{s.capturedAt ? new Date(s.capturedAt).toLocaleString('pt-BR') : '—'}</td>
                <td className="num">{s.saleFormatted || s.price || '—'}</td>
                <td className="num">{fmt(s.soldCount)}</td>
                <td className="num">{s.rating ?? '—'}</td>
                <td className="num">{fmt(s.viralScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Vídeos relacionados ({videos.length})</h3>
        {videos.length === 0 ? (
          <p className="muted">Nenhum vídeo com esse produto vinculado ainda.</p>
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
