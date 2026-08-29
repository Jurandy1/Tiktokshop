import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { fetchRecentRuns } from '../lib/products';

const DEFAULT_QUERIES = ['achadinhos', 'tiktokshop'];
const DEFAULT_VIDEO_HASHTAGS = ['tiktokshop', 'achadinhos'];

function statusDot(ok) {
  return ok ? 'bg-emerald-500' : 'bg-tiktok-pink';
}

export default function Sistema() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRuns(await fetchRecentRuns(15));
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
      <div className="bg-tiktok-card border border-tiktok-border rounded-xl p-5 md:p-6 space-y-4">
        <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-tiktok-cyan" />
          Sistema
        </h2>
        <p className="text-sm text-tiktok-muted">Diagnóstico somente leitura — sem nada editável por aqui.</p>

        <div className="grid md:grid-cols-2 gap-4 pt-2">
          <div className="bg-black/40 border border-tiktok-border rounded-lg p-4">
            <h3 className="text-xs text-tiktok-muted uppercase tracking-wider mb-2">Seeds permanentes de produtos</h3>
            <p className="text-sm font-mono text-white">{DEFAULT_QUERIES.join(', ')}</p>
          </div>
          <div className="bg-black/40 border border-tiktok-border rounded-lg p-4">
            <h3 className="text-xs text-tiktok-muted uppercase tracking-wider mb-2">Seeds permanentes de vídeos</h3>
            <p className="text-sm font-mono text-white">{DEFAULT_VIDEO_HASHTAGS.join(', ')}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-tiktok-card border border-tiktok-border rounded-xl overflow-hidden">
        <h3 className="text-base font-semibold text-white px-5 py-4 border-b border-tiktok-border">
          Últimas execuções
        </h3>
        {loading ? (
          <div className="text-center py-12 text-tiktok-muted">Carregando…</div>
        ) : runs.length === 0 ? (
          <p className="text-tiktok-muted px-5 py-8">Nenhuma execução registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tiktok-border text-tiktok-muted text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-medium">Início</th>
                  <th className="text-left px-5 py-3 font-medium">Origem</th>
                  <th className="text-right px-5 py-3 font-medium">Encontrados</th>
                  <th className="text-right px-5 py-3 font-medium">Salvos</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const found = r.productsFound ?? r.totalVideosFound ?? '—';
                  const saved = r.productsSaved ?? r.videosSaved ?? '—';
                  const ok = !r.errors?.length;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-tiktok-border/50 hover:bg-tiktok-hover transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-xs">
                        {r.startedAt ? new Date(r.startedAt).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-5 py-3 text-tiktok-muted text-xs">{r.source || '—'}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">{found}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">{saved}</td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 text-xs text-tiktok-muted">
                          <span className={`w-2 h-2 rounded-full ${statusDot(ok)}`} />
                          {ok ? 'ok' : `${r.errors.length} erro(s)`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
