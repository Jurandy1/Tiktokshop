import { Link } from 'react-router-dom';
import { ShoppingCart, Star } from 'lucide-react';

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

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2318181B"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">sem foto</text></svg>';

export default function ProductCard({ product, rank }) {
  const img = product.image || product.imageUrl || product.images?.[0] || PLACEHOLDER;
  const rating = product.rating != null ? Number(product.rating).toFixed(1) : null;

  return (
    <Link
      to={`/product/${product.id}`}
      className="bg-tiktok-card border border-tiktok-border rounded-xl overflow-hidden premium-card group cursor-pointer relative flex flex-col no-underline hover:no-underline"
    >
      {rank != null && (
        <div
          className={`absolute top-2 left-2 md:top-3 md:left-3 text-white text-[9px] md:text-[10px] font-bold px-2 py-1 rounded z-10 ${
            rank === 1
              ? 'bg-gradient-to-r from-tiktok-cyan to-tiktok-pink shadow-lg shadow-tiktok-pink/20'
              : 'bg-zinc-800/80 backdrop-blur border border-zinc-600'
          }`}
        >
          #{rank}
        </div>
      )}
      {product.viralScore > 0 && (
        <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-[#FE2C55]/90 backdrop-blur-sm text-white text-[9px] md:text-[10px] font-bold px-2 py-1 rounded-sm z-10">
          {fmt(product.viralScore)}
        </div>
      )}

      <div className="aspect-square bg-zinc-800 relative overflow-hidden">
        <img
          src={img}
          alt=""
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = PLACEHOLDER;
          }}
          referrerPolicy="no-referrer"
        />
      </div>

      <div className="p-3 md:p-4 flex flex-col flex-1 justify-between">
        <div>
          <h3 className="text-xs md:text-sm font-medium text-white line-clamp-2 leading-tight mb-1 group-hover:text-tiktok-cyan transition-colors">
            {product.title || product.id}
          </h3>
          {product.seller?.name && (
            <p className="text-[10px] md:text-xs text-tiktok-muted mb-2 md:mb-3">{product.seller.name}</p>
          )}
        </div>
        <div>
          <p className="text-base md:text-lg font-bold text-white mb-2">{fmtPrice(product)}</p>
          <div className="flex items-center justify-between text-[10px] md:text-xs text-tiktok-muted">
            <span className="flex items-center gap-1">
              <ShoppingCart className="w-3 h-3" />
              {fmt(product.soldCount)} vendidos
            </span>
            {rating && (
              <span className="flex items-center gap-1 text-yellow-500">
                <Star className="w-3 h-3 fill-current" />
                {rating}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
