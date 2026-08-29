import { useEffect, useMemo, useState } from 'react';
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

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function statusColor(s) {
  return s === 'done' ? 'ok' : s === 'running' ? 'warn' : s === 'error' ? 'err' : 'muted';
}

// Cada modo é um fetch server-side já pronto — nada de re-ordenar client-side
// sobre uma janela pequena (isso não era um top-N de verdade).
const MODE_FETCHERS = {
  viral: fetchTopViral,
  sold: fetchTopBySold,
  rating: fetchTopByRating,
  withVideos: fetchProductsWithVideos,
};

/** category_breadcrumb vem como [{category_id, category_name, level}], nível 1 = mais amplo. */
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
  const [mode, setMode] = useState('viral'); // viral | sold | rating | withVideos
  const [minSold, setMinSold] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [category, setCategory] = useState('');

  const [requests, setRequests] = useState([]);
  const [queueQueries, setQueueQueries] = useState('achadinhos,tiktokshop');
  const [queueEnrich, setQueueEnrich] = useState(0);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMsg, setQueueMsg] = useState(null);
  // Guarda a request que acabamos de enfileirar nesta sessão, pra saber quando
  // ela terminar e filtrar a lista só pros resultados dessa busca.
  const [pendingRequest, setPendingRequest] = useState(null); // { id, queries }

  async function load() {
    setLoading(true);
    try {
      const fetcher = MODE_FETCHERS[mode] || fetchTopViral;
      const [tv, c, r] = await Promise.all([
        fetcher(60),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const unsub = watchRecentRequests((docs) => setRequests(docs));
    return () => unsub();
  }, []);

  // Quando a request que a gente enfileirou termina, recarrega e já filtra
  // a lista pros termos dessa busca — sem isso o resultado fica misturado e
  // enterrado entre os produtos de buscas antigas, ordenados por popularidade.
  // Observa o doc específico (não a lista das 5 mais recentes) — se outra
  // aba/pessoa enfileirar junto, a nossa request pode "sair" dessa janela
  // antes de terminar.
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

  // Categorias disponíveis na janela atual carregada — só as que existem de
  // verdade nesse lote (category_breadcrumb vem em ~20-25% dos produtos).
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
    const queries = queueQueries.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const id = await requestScrape({ queries, enrich: Number(queueEnrich) || 0 });
      setPendingRequest({ id, queries });
      setQueueMsg({ ok: true, text: `Enfileirada ${id}. Assim que terminar, a lista já filtra pra essa busca.` });
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
              Manda a request pro Firestore. Uma Cloud Function dispara a coleta
              automaticamente — não precisa nada rodando no seu PC.
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
              title="Enrich via Chrome local — só funciona rodando npm run watcher no PC, não em produção"
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
        <div className="mode-tabs">
          <button className={mode === 'viral' ? 'active' : ''} onClick={() => setMode('viral')}>Em alta</button>
          <button className={mode === 'sold' ? 'active' : ''} onClick={() => setMode('sold')}>Mais vendidos</button>
          <button className={mode === 'rating' ? 'active' : ''} onClick={() => setMode('rating')}>Melhores avaliados</button>
          <button className={mode === 'withVideos' ? 'active' : ''} onClick={() => setMode('withVideos')}>Com vídeos virais</button>
        </div>

        <div className="filters">
          <input
            type="text"
            className="search"
            placeholder="🔎 Buscar produto ou loja..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="filter-group">
            <label>Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__none__">Sem categoria</option>
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

          <div className="filter-group">
            <label>Mín. avaliação</label>
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value) || 0)}
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
