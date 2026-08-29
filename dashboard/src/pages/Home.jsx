import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Zap } from 'lucide-react';
import {
  fetchTopViral,
  fetchTopBySold,
  fetchTopByRating,
  fetchProductsWithVideos,
  fetchCounts,
  fetchRecentRuns,
} from '../lib/products';
import { requestScrape, watchRecentRequests, watchRequest } from '../lib/scrape-requests';
import ProductCard from '../components/ProductCard';
import MetricCard from '../components/MetricCard';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function statusColor(s) {
  if (s === 'done') return 'bg-emerald-500';
  if (s === 'running') return 'bg-amber-500';
  if (s === 'error') return 'bg-tiktok-pink';
  return 'bg-zinc-600';
}

const MODE_FETCHERS = {
  viral: fetchTopViral,
  sold: fetchTopBySold,
  rating: fetchTopByRating,
  withVideos: fetchProductsWithVideos,
};

const MODES = [
  { id: 'viral', label: 'Em alta' },
  { id: 'sold', label: 'Mais vendidos' },
  { id: 'rating', label: 'Melhores avaliados' },
  { id: 'withVideos', label: 'Com vídeos virais' },
];

function categoryLabel(product) {
  const cat = Array.isArray(product.category) ? product.category[0] : null;
  return cat?.category_name || null;
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({ products: 0, runs: 0 });
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('viral');
  const [minSold, setMinSold] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [category, setCategory] = useState('');

  const [requests, setRequests] = useState([]);
  const [queueQueries, setQueueQueries] = useState('achadinhos,tiktokshop');
  const [queueEnrich, setQueueEnrich] = useState(0);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMsg, setQueueMsg] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const fetcher = MODE_FETCHERS[mode] || fetchTopViral;
      const [tv, c, r] = await Promise.all([fetcher(60), fetchCounts(), fetchRecentRuns(5)]);
      setProducts(tv);
      setCounts(c);
      setRuns(r);
      setError(null);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('permission') || msg.includes('Permission')) {
        setError(
          'Sem permissão no Firestore. Confira as Rules e faça login com gorilaalbino1996@gmail.com.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const unsub = watchRecentRequests((docs) => setRequests(docs));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!pendingRequest) return;
    const unsub = watchRequest(pendingRequest.id, (data) => {
      if (data?.status === 'done') {
        setPendingRequest(null);
        setSearch(pendingRequest.queries.join(', '));
        load();
      } else if (data?.status === 'error') {
        setPendingRequest(null);
      }
    });
    return () => unsub();
  }, [pendingRequest]);

  const categories = useMemo(() => {
    const set = new Set(products.map(categoryLabel).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const filtered = useMemo(() => {
    const terms = search
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    let out = products.filter(
      (p) => (p.soldCount ?? 0) >= minSold && (p.rating ?? 0) >= minRating
    );
    if (terms.length) {
      out = out.filter((p) => {
        const title = (p.title || '').toLowerCase();
        const seller = (p.seller?.name || '').toLowerCase();
        return terms.some((t) => title.includes(t) || seller.includes(t));
      });
    }
    if (category === '__none__') {
      out = out.filter((p) => !categoryLabel(p));
    } else if (category) {
      out = out.filter((p) => categoryLabel(p) === category);
    }
    return out;
  }, [products, search, minSold, minRating, category]);

  async function onQueue() {
    setQueueBusy(true);
    setQueueMsg(null);
    const queries = queueQueries
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const id = await requestScrape({ queries, enrich: Number(queueEnrich) || 0 });
      setPendingRequest({ id, queries });
      setQueueMsg({
        ok: true,
        text: `Enfileirada ${id}. Assim que terminar, a lista já filtra pra essa busca.`,
      });
    } catch (err) {
      setQueueMsg({ ok: false, text: err.message });
    } finally {
      setQueueBusy(false);
    }
  }

  const inputClass =
    'bg-black/50 border border-tiktok-border rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-tiktok-cyan transition-colors';

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Produtos únicos" value={fmt(counts.products)} />
        <MetricCard label="Runs registradas" value={fmt(counts.runs)} />
        <MetricCard label="Última coleta">
          <p className="text-sm md:text-base font-semibold font-mono text-white">
            {runs[0]?.startedAt ? new Date(runs[0].startedAt).toLocaleString('pt-BR') : '—'}
          </p>
        </MetricCard>
        <MetricCard label="Atualizar">
          <button
            type="button"
            onClick={load}
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

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6 border-l-4 border-l-tiktok-cyan">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
              <Zap className="w-5 h-5 text-tiktok-cyan" />
              Coletar agora
            </h2>
            <p className="text-sm text-tiktok-muted">
              Manda a request pro Firestore. Uma Cloud Function dispara a coleta automaticamente — não
              precisa nada rodando no seu PC.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={queueQueries}
              onChange={(e) => setQueueQueries(e.target.value)}
              placeholder="queries (separadas por vírgula)"
              className={`${inputClass} min-w-[200px] flex-1`}
            />
            <input
              type="number"
              min="0"
              max="20"
              value={queueEnrich}
              onChange={(e) => setQueueEnrich(e.target.value)}
              title="Enrich via Chrome local"
              className={`${inputClass} w-20`}
            />
            <button
              type="button"
              onClick={onQueue}
              disabled={queueBusy}
              className="px-4 py-2 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
            >
              {queueBusy ? '…' : '▶ Enfileirar'}
            </button>
          </div>
        </div>

        {queueMsg && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg text-sm ${
              queueMsg.ok
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                : 'bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink'
            }`}
          >
            {queueMsg.text}
          </div>
        )}

        {requests.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-4">
            {requests.slice(0, 4).map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 bg-black/40 border border-tiktok-border px-3 py-1.5 rounded-full text-xs"
              >
                <span className={`w-2 h-2 rounded-full ${statusColor(r.status)}`} />
                <span>{Array.isArray(r.queries) ? r.queries.join(', ') : '—'}</span>
                <span className="text-tiktok-muted">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6 space-y-5">
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m.id
                  ? 'bg-black/50 text-white border border-tiktok-cyan/50 shadow-[0_0_10px_rgba(37,244,238,0.08)]'
                  : 'text-tiktok-muted border border-tiktok-border hover:text-white hover:bg-tiktok-hover'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end pb-4 border-b border-tiktok-border">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tiktok-muted" />
            <input
              type="text"
              placeholder="Buscar produto ou loja..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} w-full pl-10`}
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-tiktok-muted uppercase tracking-wider">Categoria</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__none__">Sem categoria</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-tiktok-muted uppercase tracking-wider">Mín. vendidos</span>
            <input
              type="number"
              min="0"
              value={minSold}
              onChange={(e) => setMinSold(Number(e.target.value) || 0)}
              className={`${inputClass} w-24`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-tiktok-muted uppercase tracking-wider">Mín. avaliação</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value) || 0)}
              className={`${inputClass} w-24`}
            />
          </label>

          <span className="text-sm text-tiktok-muted ml-auto">
            {filtered.length} de {products.length}
          </span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-tiktok-muted">Carregando…</div>
        ) : filtered.length === 0 ? (
          <p className="text-tiktok-muted">Nenhum produto bate o filtro.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-5">
            {filtered.map((p, i) => (
              <ProductCard key={p.id} product={p} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
