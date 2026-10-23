"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LockKeyhole, Store } from "lucide-react";

export function LoginForm({ setup, next }: { setup: boolean; next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.replace(next?.startsWith("/app") ? next : "/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,.13),transparent_55%)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent"><Store size={24} /></div>
          <div><h1 className="text-xl font-semibold">Central de Vendas</h1><p className="text-sm text-muted">Mercado Livre + Shopee</p></div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-7 shadow-soft">
          <div className="mb-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted"><LockKeyhole size={19} /></div>
            <h2 className="text-lg font-semibold">Entrar no painel</h2>
            <p className="mt-1 text-sm text-muted">Use o usuário criado no Supabase Auth.</p>
          </div>
          {setup && <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">Configure as variáveis do Supabase antes de entrar.</p>}
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm text-gray-300">
              E-mail
              <input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-line bg-ink px-4 py-3 outline-none transition focus:border-accent" placeholder="voce@exemplo.com" />
            </label>
            <label className="block text-sm text-gray-300">
              Senha
              <input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-line bg-ink px-4 py-3 outline-none transition focus:border-accent" placeholder="Sua senha" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
            <button disabled={loading} className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">{loading ? "Entrando..." : "Entrar"}</button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs leading-5 text-muted">A conta precisa ser criada previamente em Authentication → Users no Supabase.</p>
      </div>
    </main>
  );
}
