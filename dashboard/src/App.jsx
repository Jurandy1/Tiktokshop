import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { isConfigured } from './lib/firebase';
import { watchAuth, logout } from './lib/auth';
import LoginGate from './components/LoginGate';
import Home from './pages/Home';
import Product from './pages/Product';
import Videos from './pages/Videos';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = watchAuth((u) => {
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!isConfigured()) {
    return (
      <div className="app">
        <div className="error-box">
          Firebase não configurado. Crie <code>dashboard/.env</code> com as chaves
          (veja <code>dashboard/.env.example</code>).
        </div>
      </div>
    );
  }

  if (!ready) return <div className="loading">…</div>;
  if (!user) return <LoginGate />;

  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <h1><Link to="/">TikTok Shop</Link></h1>
          <nav className="header-nav">
            <Link to="/">Produtos</Link>
            <Link to="/videos">Vídeos</Link>
          </nav>
          <div className="header-right">
            <span className="muted small">{user.email}</span>
            <button className="btn ghost" onClick={logout}>Sair</button>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/product/:id" element={<Product />} />
          <Route path="/videos" element={<Videos />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
