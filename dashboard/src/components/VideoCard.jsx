import { Link } from 'react-router-dom';
import { Tag, Play, Eye, Heart } from 'lucide-react';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2318181B"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">sem capa</text></svg>';

export default function VideoCard({ video }) {
  const img = video.coverUrl || PLACEHOLDER;
  const viralScore = video.lastViralScore || video.viralScore;

  return (
    <a
      href={video.videoUrl || '#'}
      target="_blank"
      rel="noreferrer"
      className="bg-tiktok-card border border-tiktok-border rounded-xl overflow-hidden premium-card group cursor-pointer flex flex-col no-underline hover:no-underline"
    >
      <div className="aspect-[4/5] bg-zinc-800 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10 pointer-events-none" />

        {video.productKnown && (
          <div className="absolute top-2 left-2 md:top-3 md:left-3 bg-black/60 backdrop-blur-md text-white text-[9px] md:text-[10px] font-bold px-2 py-1 rounded z-20 flex items-center gap-1">
            <Tag className="w-3 h-3 text-tiktok-cyan" />
            Produto
          </div>
        )}
        {viralScore > 0 && (
          <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-[#FE2C55]/90 text-white text-[9px] md:text-[10px] font-bold px-2 py-1 rounded-sm z-20">
            {fmt(viralScore)}
          </div>
        )}

        <img
          src={img}
          alt=""
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = PLACEHOLDER;
          }}
          referrerPolicy="no-referrer"
        />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
          <div className="bg-black/50 p-2 md:p-3 rounded-full backdrop-blur-sm">
            <Play className="w-6 h-6 md:w-8 md:h-8 text-white fill-current" />
          </div>
        </div>
      </div>

      <div className="p-3 md:p-4 flex flex-col flex-1 gap-1.5 md:gap-2 bg-tiktok-card relative z-20 -mt-2">
        {video.author?.uniqueId && (
          <p className="text-[10px] md:text-xs font-semibold text-tiktok-cyan truncate">
            @{video.author.uniqueId}
          </p>
        )}
        <h3 className="text-xs md:text-sm font-medium text-white line-clamp-2 leading-snug">
          {video.description || video.videoId}
        </h3>

        {video.productKnown && video.productId && (
          <div className="mt-2 bg-black/50 border border-tiktok-border rounded-lg p-1.5 md:p-2 flex flex-col">
            <span className="text-[8px] md:text-[10px] text-tiktok-muted uppercase tracking-wider">
              ID Produto associado
            </span>
            {video.productTitle ? (
              <Link
                to={`/product/${video.productId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] md:text-xs text-tiktok-cyan truncate no-underline hover:underline"
              >
                {video.productTitle}
              </Link>
            ) : (
              <span className="text-[10px] md:text-xs font-mono text-zinc-300 truncate">{video.productId}</span>
            )}
          </div>
        )}

        {!video.productKnown && (
          <p className="text-[10px] md:text-xs text-tiktok-muted">Sem produto identificado</p>
        )}

        <div className="mt-auto pt-2 md:pt-3 flex items-center justify-between text-[10px] md:text-xs font-medium border-t border-tiktok-border/50">
          <span className="flex items-center gap-1 md:gap-1.5 text-zinc-300">
            <Eye className="w-3 h-3 md:w-3.5 md:h-3.5 text-tiktok-muted" />
            {fmt(video.lastPlayCount)} views
          </span>
          <span className="flex items-center gap-1 md:gap-1.5 text-tiktok-pink">
            <Heart className="w-3 h-3 md:w-3.5 md:h-3.5 fill-current" />
            {fmt(video.lastLikeCount)} curtidas
          </span>
        </div>
      </div>
    </a>
  );
}
