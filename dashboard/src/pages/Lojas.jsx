import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { fetchSellers } from '../lib/products';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2318181B"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">loja</text></svg>';

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
      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6">
        <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2 mb-2">
          <Store className="w-5 h-5 text-tiktok-cyan" />
          Lojas
        </h2>
        <p className="text-sm text-tiktok-muted">
          Vendedores encontrados nos produtos monitorados. A soma de vendas é dos produtos já coletados
          desta loja — não é o total de vendas real da loja no TikTok Shop.
        </p>
      </div>

      {error && (
        <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-tiktok-muted">Carregando…</div>
      ) : sellers.length === 0 ? (
        <p className="text-tiktok-muted">Nenhuma loja encontrada ainda.</p>
      ) : (
        <div className="bg-tiktok-card border border-tiktok-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tiktok-border text-tiktok-muted text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-medium">Loja</th>
                  <th className="text-right px-5 py-3 font-medium">Produtos encontrados</th>
                  <th className="text-right px-5 py-3 font-medium">Vendas (monitorados)</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-tiktok-border/50 hover:bg-tiktok-hover transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={s.logo || PLACEHOLDER}
                          alt=""
                          className="w-8 h-8 rounded-lg object-cover bg-zinc-800 flex-shrink-0"
                          onError={(e) => {
                            e.currentTarget.src = PLACEHOLDER;
                          }}
                          referrerPolicy="no-referrer"
                        />
                        <span className="text-white font-medium">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums">{fmt(s.productCount)}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums">{fmt(s.soldCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
