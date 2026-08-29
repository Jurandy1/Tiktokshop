import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function SectionHeader({ icon: Icon, iconColor = 'text-tiktok-cyan', title, to }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
        {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
        {title}
      </h2>
      {to && (
        <Link
          to={to}
          className="text-xs md:text-sm font-medium text-tiktok-muted hover:text-white transition-colors flex items-center gap-1 no-underline hover:no-underline"
        >
          Ver todos <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
