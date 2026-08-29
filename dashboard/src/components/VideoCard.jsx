import { Link } from 'react-router-dom';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231a2233"/><text x="50" y="55" font-size="10" fill="%23555" text-anchor="middle">sem capa</text></svg>';

export default function VideoCard({ video }) {
  const img = video.coverUrl || PLACEHOLDER;

  return (
    <a href={video.videoUrl || '#'} target="_blank" rel="noreferrer" className="pcard">
      <div className="pcard-img-wrap">
        <img
          src={img}
          alt=""
          className="pcard-img"
          loading="lazy"
          onError={(e) => { e.currentTarget.src = PLACEHOLDER; }}
          referrerPolicy="no-referrer"
        />
        {video.lastViralScore > 0 && (
          <span className="pcard-viral">🔥 {fmt(video.lastViralScore)}</span>
        )}
        {video.productKnown && <span className="pcard-rank">🛒</span>}
      </div>

      <div className="pcard-body">
        <h3 className="pcard-title">{video.description || video.videoId}</h3>
        {video.author?.uniqueId && <div className="pcard-seller">@{video.author.uniqueId}</div>}

        {video.productKnown ? (
          <div className="pcard-price">
            {video.productTitle ? (
              <Link to={`/product/${video.productId}`} onClick={(e) => e.stopPropagation()}>
                {video.productTitle}
              </Link>
            ) : (
              `Produto ${video.productId}`
            )}
          </div>
        ) : (
          <div className="muted small">Sem produto identificado</div>
        )}

        <div className="pcard-meta">
          <span className="pcard-sold">{fmt(video.lastPlayCount)} views</span>
          <span className="pcard-rating">❤️ {fmt(video.lastLikeCount)}</span>
        </div>
      </div>
    </a>
  );
}
