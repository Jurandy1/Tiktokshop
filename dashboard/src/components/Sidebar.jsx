import { Link, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Video,
  Store,
  Settings,
  LogOut,
  X,
} from 'lucide-react';

const NAV = [
  { to: '/', end: true, label: 'Visão geral', icon: LayoutDashboard },
  { to: '/produtos', label: 'Produtos', icon: ShoppingBag },
  { to: '/videos', label: 'Vídeos virais', icon: Video },
  { to: '/lojas', label: 'Lojas', icon: Store },
  { to: '/configuracoes', label: 'Sistema', icon: Settings },
];

function NavItems({ onNavigate }) {
  return NAV.map(({ to, end, label, icon: Icon }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors no-underline hover:no-underline ${
          isActive
            ? 'bg-tiktok-card text-white border border-tiktok-border shadow-[0_0_10px_rgba(37,244,238,0.05)]'
            : 'text-tiktok-muted hover:text-white hover:bg-tiktok-hover'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`w-5 h-5 ${isActive ? 'text-tiktok-cyan' : ''}`} />
          {label}
        </>
      )}
    </NavLink>
  ));
}

export default function Sidebar({ userEmail, onLogout, mobileOpen, onMobileClose }) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={onMobileClose}
          aria-label="Fechar menu"
        />
      )}

      <aside
        className={`w-64 bg-tiktok-bg border-r border-tiktok-border flex flex-col justify-between flex-shrink-0 z-40
          fixed md:static inset-y-0 left-0 transform transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div>
          <div className="h-20 flex items-center justify-between px-6 border-b border-tiktok-border/50 tiktok-logo">
            <Link to="/" className="text-xl font-bold tracking-tight relative group no-underline hover:no-underline">
              <span className="absolute top-0 left-0 text-tiktok-cyan glitch-cyan transition-all duration-300 opacity-0 -z-10">
                TikTok Shop
              </span>
              <span className="absolute top-0 left-0 text-tiktok-pink glitch-pink transition-all duration-300 opacity-0 -z-10">
                TikTok Shop
              </span>
              <span className="relative text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-tiktok-cyan group-hover:to-tiktok-pink transition-all duration-300">
                TikTok Shop
              </span>
            </Link>
            <button
              type="button"
              className="md:hidden text-tiktok-muted hover:text-white"
              onClick={onMobileClose}
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="p-4 space-y-1 mt-4">
            <NavItems onNavigate={onMobileClose} />
          </nav>
        </div>

        <div className="p-4 border-t border-tiktok-border/50">
          <div className="px-4 py-3 truncate flex flex-col gap-3">
            <span className="text-xs text-tiktok-muted font-medium truncate">{userEmail}</span>
            <button
              type="button"
              onClick={onLogout}
              className="w-full py-2 bg-tiktok-card hover:bg-tiktok-hover border border-tiktok-border rounded-lg text-sm font-medium transition-colors text-white flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
