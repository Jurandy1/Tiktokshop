import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { isConfigured } from './lib/firebase';
import { watchAuth, logout } from './lib/auth';
import LoginGate from './components/LoginGate';
import Sidebar from './components/Sidebar';
import Overview from './pages/Overview';
import Home from './pages/Home';
import Product from './pages/Product';
import Videos from './pages/Videos';
import Lojas from './pages/Lojas';
import Sistema from './pages/Sistema';

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
      <div className="app-shell">
        <Sidebar userEmail={user.email} onLogout={logout} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/produtos" element={<Home />} />
            <Route path="/product/:id" element={<Product />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/lojas" element={<Lojas />} />
            <Route path="/configuracoes" element={<Sistema />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
