import { useEffect, useState } from 'react';
import { fetchSellers } from '../lib/products';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231a2233"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">loja</text></svg>';

export default function Lojas() {
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setSellers(await fetchSellers());
        setError(null);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <div className="card">
        <h2>Lojas</h2>
        <p className="muted small">
          Vendedores encontrados nos produtos monitorados. A soma de vendas é dos
          produtos já coletados desta loja — não é o total de vendas real da loja
          no TikTok Shop.
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading ? (
        <div className="loading">…</div>
      ) : sellers.length === 0 ? (
        <p className="muted">Nenhuma loja encontrada ainda.</p>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Loja</th>
                <th className="num">Produtos encontrados</th>
                <th className="num">Vendas (produtos monitorados)</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="seller-row">
                      <img
                        src={s.logo || PLACEHOLDER}
                        alt=""
                        className="seller-logo"
                        onError={(e) => { e.currentTarget.src = PLACEHOLDER; }}
                        referrerPolicy="no-referrer"
                      />
                      {s.name}
                    </div>
                  </td>
                  <td className="num">{fmt(s.productCount)}</td>
                  <td className="num">{fmt(s.soldCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
