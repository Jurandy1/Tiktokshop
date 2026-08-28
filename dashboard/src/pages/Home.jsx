import { useEffect, useMemo, useState } from 'react';
import { fetchTopViral, fetchCounts, fetchRecentRuns } from '../lib/products';
import { requestScrape, watchRecentRequests } from '../lib/scrape-requests';
import ProductCard from '../components/ProductCard';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function statusColor(s) {
  return s === 'done' ? 'ok' : s === 'running' ? 'warn' : s === 'error' ? 'err' : 'muted';
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({ products: 0, runs: 0 });
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('viral'); // viral | sold | rating | price
  const [minSold, setMinSold] = useState(0);

  const [requests, setRequests] = useState([]);
  const [queueQueries, setQueueQueries] = useState('achadinhos,tiktokshop');
  const [queueEnrich, setQueueEnrich] = useState(5);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMsg, setQueueMsg] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [tv, c, r] = await Promise.all([
        fetchTopViral(60),
        fetchCounts(),
        fetchRecentRuns(5),
      ]);
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
    const unsub = watchRecentRequests((docs) => setRequests(docs));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = products.filter((p) => (p.soldCount ?? 0) >= minSold);
    if (q) {
      out = out.filter(
        (p) =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.seller?.name || '').toLowerCase().includes(q)
      );
    }
    out.sort((a, b) => {
      const va = a[sortBy === 'viral' ? 'viralScore' : sortBy === 'sold' ? 'soldCount' : sortBy === 'rating' ? 'rating' : 'price'] || 0;
      const vb = b[sortBy === 'viral' ? 'viralScore' : sortBy === 'sold' ? 'soldCount' : sortBy === 'rating' ? 'rating' : 'price'] || 0;
      return sortBy === 'price' ? va - vb : vb - va;
    });
    return out;
  }, [products, search, sortBy, minSold]);

  async function onQueue() {
    setQueueBusy(true);
    setQueueMsg(null);
    try {
      const id = await requestScrape({
        queries: queueQueries.split(',').map((s) => s.trim()).filter(Boolean),
        enrich: Number(queueEnrich) || 0,
      });
      setQueueMsg({ ok: true, text: `Enfileirada ${id}. Se o watcher estiver rodando no PC, roda em segundos.` });
    } catch (err) {
      setQueueMsg({ ok: false, text: err.message });
    } finally {
      setQueueBusy(false);
    }
  }

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">Produtos únicos</div>
          <div className="value">{fmt(counts.products)}</div>
        </div>
        <div className="stat">
          <div className="label">Runs registradas</div>
          <div className="value">{fmt(counts.runs)}</div>
        </div>
        <div className="stat">
          <div className="label">Última coleta</div>
          <div className="value small">
            {runs[0]?.startedAt
              ? new Date(runs[0].startedAt).toLocaleString('pt-BR')
              : '—'}
          </div>
        </div>
        <div className="stat action-stat">
          <button className="btn ghost" onClick={load} disabled={loading}>
            {loading ? '…' : '↻ Recarregar'}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card scrape-card">
        <div className="scrape-head">
          <div>
            <h2>Coletar agora</h2>
            <p className="muted small">
              Manda a request pro Firestore. Se <code>npm run watcher</code> tiver
              rodando no PC, ele coleta e salva sozinho.
            </p>
          </div>
          <div className="scrape-form">
            <input
              type="text"
              value={queueQueries}
              onChange={(e) => setQueueQueries(e.target.value)}
              placeholder="queries (separadas por vírgula)"
            />
            <input
              type="number"
              min="0"
              max="20"
              value={queueEnrich}
              onChange={(e) => setQueueEnrich(e.target.value)}
              title="Enrich top N via Chrome debug"
              className="narrow"
            />
            <button className="btn" onClick={onQueue} disabled={queueBusy}>
              {queueBusy ? '…' : '▶ Enfileirar'}
            </button>
          </div>
        </div>

        {queueMsg && (
          <div className={queueMsg.ok ? 'ok-box' : 'error-box'}>{queueMsg.text}</div>
        )}

        {requests.length > 0 && (
          <div className="requests-mini">
            {requests.slice(0, 4).map((r) => (
              <div key={r.id} className="req-chip">
                <span className={`dot ${statusColor(r.status)}`} />
                <span className="req-q">{Array.isArray(r.queries) ? r.queries.join(', ') : '—'}</span>
                <span className="muted small">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="filters">
          <input
            type="text"
            className="search"
            placeholder="🔎 Buscar produto ou loja..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="filter-group">
            <label>Ordenar por</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="viral">Viral score</option>
              <option value="sold">Mais vendidos</option>
              <option value="rating">Melhor avaliados</option>
              <option value="price">Menor preço</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Mín. vendidos</label>
            <input
              type="number"
              min="0"
              value={minSold}
              onChange={(e) => setMinSold(Number(e.target.value) || 0)}
              className="narrow"
            />
          </div>

          <div className="filter-count muted small">
            {filtered.length} de {products.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="muted">Nenhum produto bate o filtro.</p>
        ) : (
          <div className="pgrid">
            {filtered.map((p, i) => (
              <ProductCard key={p.id} product={p} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
