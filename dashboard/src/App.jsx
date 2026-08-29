import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Menu } from 'lucide-react';
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
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const unsub = watchAuth((u) => {
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!isConfigured()) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-tiktok-bg">
        <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink px-6 py-4 rounded-xl max-w-lg">
          Firebase não configurado. Crie <code className="bg-black/40 px-1.5 py-0.5 rounded">dashboard/.env</code>{' '}
          com as chaves (veja <code className="bg-black/40 px-1.5 py-0.5 rounded">dashboard/.env.example</code>).
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tiktok-bg text-tiktok-muted">
        Carregando…
      </div>
    );
  }

  if (!user) return <LoginGate />;

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden antialiased bg-tiktok-bg text-white">
        <Sidebar
          userEmail={user.email}
          onLogout={logout}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        <main className="flex-1 overflow-y-auto bg-tiktok-bg relative min-w-0">
          <div className="md:hidden flex items-center justify-between p-4 border-b border-tiktok-border bg-tiktok-bg z-20 sticky top-0">
            <span className="text-lg font-bold text-white">TikTok Shop</span>
            <button
              type="button"
              className="text-white"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>

          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-tiktok-cyan/5 blur-[120px] rounded-full pointer-events-none" />

          <div className="max-w-[1600px] mx-auto p-4 md:p-8 relative z-10 space-y-8 md:space-y-10">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/produtos" element={<Home />} />
              <Route path="/product/:id" element={<Product />} />
              <Route path="/videos" element={<Videos />} />
              <Route path="/lojas" element={<Lojas />} />
              <Route path="/configuracoes" element={<Sistema />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
