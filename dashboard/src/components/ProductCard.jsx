import { Link } from 'react-router-dom';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtPrice(p) {
  if (p.saleFormatted) return `${p.currency || 'R$'} ${p.saleFormatted}`;
  if (p.price != null) return `${p.currency || 'R$'} ${p.price}`;
  return '—';
}

const PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231a2233"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">sem foto</text></svg>';

export default function ProductCard({ product, rank }) {
  const img = product.image || product.imageUrl || product.images?.[0] || PLACEHOLDER;
  const rating = product.rating != null ? Number(product.rating).toFixed(1) : null;
  const reviews = product.reviewCount || null;

  return (
    <Link to={`/product/${product.id}`} className="pcard">
      <div className="pcard-img-wrap">
        <img
          src={img}
          alt=""
          className="pcard-img"
          loading="lazy"
          onError={(e) => { e.currentTarget.src = PLACEHOLDER; }}
          referrerPolicy="no-referrer"
        />
        {rank != null && <span className="pcard-rank">#{rank}</span>}
        {product.viralScore > 0 && (
          <span className="pcard-viral">{fmt(product.viralScore)}</span>
        )}
      </div>

      <div className="pcard-body">
        <h3 className="pcard-title">{product.title || product.id}</h3>
        {product.seller?.name && <div className="pcard-seller">{product.seller.name}</div>}

        <div className="pcard-price">{fmtPrice(product)}</div>

        <div className="pcard-meta">
          <span className="pcard-sold">{fmt(product.soldCount)} vendidos</span>
          {rating && (
            <span className="pcard-rating">
              ★ {rating} {reviews ? <span className="muted small">({fmt(reviews)})</span> : null}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
