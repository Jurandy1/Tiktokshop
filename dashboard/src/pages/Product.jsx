import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { fetchProductDetail } from '../lib/products';
import { fetchVideosByProduct } from '../lib/videos';
import VideoCard from '../components/VideoCard';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function Sparkline({ values, width = 500, height = 80, color = '#25F4EE' }) {
  if (!values?.length) return <div className="text-tiktok-muted text-sm">sem dados</div>;
  const nums = values.map((v) => Number(v) || 0);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const step = width / Math.max(1, nums.length - 1);
  const points = nums
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
      <text x="0" y="12" fontSize="10" fill="#71717a">
        {min}
      </text>
      <text x={width - 40} y="12" fontSize="10" fill="#71717a">
        {max}
      </text>
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

  if (loading) return <div className="text-center py-20 text-tiktok-muted">Carregando…</div>;
  if (error) {
    return (
      <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
        {error}
      </div>
    );
  }
  if (!product) {
    return (
      <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
        Produto não encontrado.
      </div>
    );
  }

  const soldSeries = (product.daily || []).map((d) => d.soldCountMax).filter((v) => v != null);
  const priceSeries = (product.daily || []).map((d) => d.priceLast).filter((v) => v != null);
  const lastSnap = product.snapshots?.[0];

  const stats = [
    { label: 'Vendidos', value: fmt(lastSnap?.soldCount) },
    { label: 'Preço', value: lastSnap?.saleFormatted || lastSnap?.price || '—' },
    { label: 'Rating', value: lastSnap?.rating != null ? `${lastSnap.rating}★` : '—' },
    { label: 'Reviews', value: fmt(lastSnap?.reviewCount) },
    { label: 'Viral', value: fmt(lastSnap?.viralScore) },
  ];

  return (
    <>
      <Link
        to="/produtos"
        className="inline-flex items-center gap-2 text-sm text-tiktok-muted hover:text-white transition-colors no-underline hover:no-underline mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        voltar
      </Link>

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {product.image && (
            <img
              src={product.image}
              alt=""
              className="w-full md:w-48 h-48 object-cover rounded-xl bg-zinc-800 flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">{product.title || product.id}</h2>
            <div className="text-sm text-tiktok-muted mb-3">
              {product.seller?.name && <>por {product.seller.name} · </>}
              productId:{' '}
              <code className="bg-black/40 px-1.5 py-0.5 rounded text-xs font-mono">{product.id}</code>
            </div>
            {product.pdpUrl && (
              <a
                href={product.pdpUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-tiktok-cyan hover:text-white transition-colors no-underline hover:no-underline"
              >
                abrir no TikTok Shop
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
              {stats.map((s) => (
                <div key={s.label} className="bg-black/40 border border-tiktok-border rounded-lg p-3">
                  <span className="text-[10px] text-tiktok-muted uppercase tracking-wider block mb-1">
                    {s.label}
                  </span>
                  <span className="text-lg font-bold font-mono text-white">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-4">Vendas ao longo do tempo</h3>
          <div className="bg-black/40 rounded-lg p-3">
            <Sparkline values={soldSeries} color="#22c55e" />
          </div>
          <p className="text-xs text-tiktok-muted mt-2">
            {soldSeries.length} pontos (últimos {product.daily?.length || 0} dias)
          </p>
        </div>
        <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-4">Preço ao longo do tempo</h3>
          <div className="bg-black/40 rounded-lg p-3">
            <Sparkline values={priceSeries} color="#25F4EE" />
          </div>
        </div>
      </div>

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl overflow-hidden">
        <h3 className="text-base font-semibold text-white px-5 py-4 border-b border-tiktok-border">
          Snapshots recentes ({product.snapshots?.length || 0})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tiktok-border text-tiktok-muted text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-medium">Capturado em</th>
                <th className="text-right px-5 py-3 font-medium">Preço</th>
                <th className="text-right px-5 py-3 font-medium">Vendidos</th>
                <th className="text-right px-5 py-3 font-medium">Rating</th>
                <th className="text-right px-5 py-3 font-medium">Viral</th>
              </tr>
            </thead>
            <tbody>
              {(product.snapshots || []).slice(0, 20).map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-tiktok-border/50 hover:bg-tiktok-hover transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs">
                    {s.capturedAt ? new Date(s.capturedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">
                    {s.saleFormatted || s.price || '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{fmt(s.soldCount)}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{s.rating ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{fmt(s.viralScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4 pb-10">
        <h3 className="text-lg font-bold text-white">Vídeos relacionados ({videos.length})</h3>
        {videos.length === 0 ? (
          <p className="text-tiktok-muted">Nenhum vídeo com esse produto vinculado ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
