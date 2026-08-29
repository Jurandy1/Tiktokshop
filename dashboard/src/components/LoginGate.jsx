import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { login } from '../lib/auth';
import { OWNER_EMAIL } from '../lib/firebase';

export default function LoginGate() {
  const [email, setEmail] = useState(OWNER_EMAIL || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-tiktok-bg relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-tiktok-cyan/5 blur-[120px] rounded-full pointer-events-none" />

      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-md bg-tiktok-card border border-tiktok-border rounded-2xl p-8 flex flex-col gap-4 shadow-2xl"
      >
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-tiktok-cyan to-tiktok-pink bg-clip-text text-transparent">
            TikTok Shop
          </h1>
          <p className="text-sm text-tiktok-muted mt-2">Painel privado — só o dono acessa.</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-tiktok-muted uppercase tracking-wider">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-black/50 border border-tiktok-border rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-tiktok-cyan transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-tiktok-muted uppercase tracking-wider">Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bg-black/50 border border-tiktok-border rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-tiktok-cyan transition-colors"
          />
        </label>

        {error && (
          <div className="bg-tiktok-pink/10 border border-tiktok-pink/30 text-tiktok-pink text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 w-full py-3 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
