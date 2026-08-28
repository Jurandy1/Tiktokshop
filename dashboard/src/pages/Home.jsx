import { useEffect, useState } from 'react';
import { fetchTopViral, fetchCounts, fetchRecentRuns } from '../lib/products';
import TopViralTable from '../components/TopViralTable';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({ products: 0, runs: 0 });
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [tv, c, r] = await Promise.all([
        fetchTopViral(30),
        fetchCounts(),
        fetchRecentRuns(5),
      ]);
      setProducts(tv);
      setCounts(c);
      setRuns(r);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
        <div className="stat">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '…' : 'Recarregar'}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2>Top produtos por viral score</h2>
        <TopViralTable items={products} />
      </div>
    </>
  );
}
