import { useEffect, useState } from 'react';
import { fetchRecentRuns } from '../lib/products';

// Espelha DEFAULT_QUERIES/DEFAULT_VIDEO_HASHTAGS definidos no backend
// (functions/src/sync-core.js e functions/src/video-core.js) — só leitura,
// não editável por aqui.
const DEFAULT_QUERIES = ['achadinhos', 'tiktokshop'];
const DEFAULT_VIDEO_HASHTAGS = ['tiktokshop', 'achadinhos'];

function statusColor(s) {
  return s === 'done' ? 'ok' : s === 'running' ? 'warn' : s === 'error' ? 'err' : 'muted';
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
      <div className="card">
        <h2>Sistema</h2>
        <p className="muted small">
          Diagnóstico somente leitura — sem nada editável por aqui.
        </p>

        <h3>Seeds permanentes de produtos</h3>
        <p>{DEFAULT_QUERIES.join(', ')}</p>

        <h3>Seeds permanentes de vídeos (hashtags)</h3>
        <p>{DEFAULT_VIDEO_HASHTAGS.join(', ')}</p>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h3>Últimas execuções</h3>
        {loading ? (
          <div className="loading">…</div>
        ) : runs.length === 0 ? (
          <p className="muted">Nenhuma execução registrada ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Início</th>
                <th>Origem</th>
                <th className="num">Encontrados</th>
                <th className="num">Salvos</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const found = r.productsFound ?? r.totalVideosFound ?? '—';
                const saved = r.productsSaved ?? r.videosSaved ?? '—';
                const ok = !r.errors?.length;
                return (
                  <tr key={r.id}>
                    <td>{r.startedAt ? new Date(r.startedAt).toLocaleString('pt-BR') : '—'}</td>
                    <td className="muted small">{r.source || '—'}</td>
                    <td className="num">{found}</td>
                    <td className="num">{saved}</td>
                    <td>
                      <span className={`dot ${statusColor(ok ? 'done' : 'error')}`} />{' '}
                      <span className="muted small">{ok ? 'ok' : `${r.errors.length} erro(s)`}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
