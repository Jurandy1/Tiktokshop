import { Link } from 'react-router-dom';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtPrice(p) {
  if (!p) return '—';
  if (p.saleFormatted) return `${p.currency || 'R$'} ${p.saleFormatted}`;
  if (p.price != null) return `${p.currency || 'R$'} ${p.price}`;
  return '—';
}

export default function TopViralTable({ items }) {
  if (!items?.length) {
    return <p className="muted">Sem produtos ainda. Rode <code>npm run sync:v2:save</code> no PC.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Produto</th>
          <th className="num">Vendidos</th>
          <th className="num">Preço</th>
          <th className="num">Rating</th>
          <th className="num">Viral</th>
        </tr>
      </thead>
      <tbody>
        {items.map((p, i) => (
          <tr key={p.id}>
            <td className="rank">{String(i + 1).padStart(2, '0')}</td>
            <td>
              <Link to={`/product/${p.id}`}>
                {p.title?.slice(0, 60) || p.id}
                {(p.title?.length ?? 0) > 60 ? '…' : ''}
              </Link>
              {p.seller?.name && (
                <div className="muted small">{p.seller.name}</div>
              )}
            </td>
            <td className="num">{fmt(p.soldCount)}</td>
            <td className="num">{fmtPrice(p)}</td>
            <td className="num">
              {p.rating != null ? `${p.rating}★` : '—'}
              {p.reviewCount ? <span className="muted small"> ({p.reviewCount})</span> : null}
            </td>
            <td className="num strong">{fmt(p.viralScore)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
