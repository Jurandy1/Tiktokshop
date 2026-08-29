import { Link, NavLink } from 'react-router-dom';

export default function Sidebar({ userEmail, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Link to="/">TikTok Shop</Link>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end>Visão geral</NavLink>
        <NavLink to="/produtos">Produtos</NavLink>
        <NavLink to="/videos">Vídeos virais</NavLink>
        <NavLink to="/lojas">Lojas</NavLink>
        <NavLink to="/configuracoes">Sistema</NavLink>
      </nav>

      <div className="sidebar-footer">
        <span className="muted small">{userEmail}</span>
        <button className="btn ghost" onClick={onLogout}>Sair</button>
      </div>
    </aside>
  );
}
