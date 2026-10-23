"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Platform = "mercado_livre" | "shopee";

export type MarketplaceConnection = {
  id: string;
  user_id: string;
  platform: Platform;
  external_account_id: string | null;
  account_label: string | null;
  status: string;
  expires_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

const platformRoutes: Record<Platform, string> = {
  mercado_livre: "mercado-livre",
  shopee: "shopee"
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";

export function MarketplaceConnections({
  connections,
  configured,
  migrationError,
  resultPlatform,
  result
}: {
  connections: MarketplaceConnection[];
  configured: Record<Platform, boolean>;
  migrationError: boolean;
  resultPlatform?: string;
  result?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function disconnect(platform: Platform, connectionId: string) {
    const platformLabel = platform === "mercado_livre" ? "Mercado Livre" : "Shopee";
    if (!window.confirm(`Remover os tokens armazenados localmente para ${platformLabel}? Isso não revoga a autorização na conta do marketplace.`)) return;

    setBusy(connectionId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/marketplaces/${platformRoutes[platform]}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId })
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Não foi possível remover a conexão.";
        throw new Error(detail);
      }
      setMessage("Tokens removidos do banco local. Revogue também o acesso nas configurações da plataforma.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover a conexão.");
    } finally {
      setBusy(null);
    }
  }

  async function synchronizeStock(platform: Platform, connectionId: string) {
    setSyncBusy(connectionId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/marketplaces/${platformRoutes[platform]}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId })
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Não foi possível agendar a sincronização.";
        throw new Error(detail);
      }
      const queued = body && typeof body === "object" && "queued" in body && typeof body.queued === "number"
        ? body.queued
        : 0;
      setMessage(`${queued} anúncio(s) na fila para atualizar o estoque.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível agendar a sincronização.");
    } finally {
      setSyncBusy(null);
    }
  }

  const callbackResult = resultPlatform === "mercado-livre" || resultPlatform === "shopee"
    ? result === "connected"
      ? "Autorização concluída e tokens cifrados armazenados no servidor."
      : result === "cancelled"
        ? "A autorização foi cancelada. Nenhuma conexão foi criada."
        : result === "not-configured"
          ? "A integração ainda não tem credenciais de servidor configuradas."
          : result === "error"
            ? "Não foi possível concluir a autorização. Confira a configuração e tente novamente."
            : ""
    : "";

  return (
    <>
      {migrationError && (
        <p role="alert" className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          Não foi possível ler as conexões. Aplique `0003_marketplace_connections.sql` e confira a configuração do Supabase.
        </p>
      )}
      {callbackResult && <p role="status" className="mb-4 rounded-xl border border-line bg-panel p-4 text-sm text-muted">{callbackResult}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}

      {(["mercado_livre", "shopee"] as const).map(platform => {
        const label = platform === "mercado_livre" ? "Mercado Livre" : "Shopee";
        const links = connections.filter(connection => connection.platform === platform);
        const active = links.filter(connection => connection.status === "connected");
        return (
          <section key={platform} className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{label}</h2>
                <p className="mt-2 text-sm text-muted">
                  {active.length ? `${active.length} conta(s) conectada(s)` : "Nenhuma conta conectada"}
                </p>
              </div>
              {configured[platform]
                ? <a href={`/api/marketplaces/${platformRoutes[platform]}/connect`} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium hover:bg-indigo-500">Conectar {label}</a>
                : <button disabled className="cursor-not-allowed rounded-xl border border-line px-4 py-2.5 text-sm text-muted">Credenciais pendentes</button>}
            </div>

            {!configured[platform] && (
              <p className="mt-3 text-xs leading-5 text-muted">
                Configure as credenciais privadas, a URL de callback, a chave de cifragem, o segredo OAuth e a chave `service_role` somente no ambiente de servidor.
              </p>
            )}

            {links.map(connection => (
              <div key={connection.id} className="mt-4 rounded-xl border border-line/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{connection.account_label || `${label} ${connection.external_account_id ?? ""}`}</p>
                    <p className="mt-1 text-xs text-muted">ID: {connection.external_account_id || "—"} · Estado: {connection.status}</p>
                  </div>
                  {connection.status === "connected" && (
                    <div className="flex flex-wrap gap-2">
                      <button disabled={syncBusy === connection.id} onClick={() => void synchronizeStock(platform, connection.id)} className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">
                        {syncBusy === connection.id ? "Agendando..." : "Sincronizar estoque"}
                      </button>
                      <button disabled={busy === connection.id} onClick={() => void disconnect(platform, connection.id)} className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">
                        {busy === connection.id ? "Removendo..." : "Remover tokens locais"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                  <p>Token válido até: {formatDate(connection.expires_at)}</p>
                  <p>Última sincronização: {formatDate(connection.last_synced_at)}</p>
                </div>
                {connection.last_error && <p className="mt-2 text-xs text-amber-200">Último erro: {connection.last_error}</p>}
              </div>
            ))}

            <p className="mt-4 text-xs leading-5 text-muted">
              A sincronização publica estoque apenas para anúncios já vinculados em Anúncios. Importação de pedidos e criação de anúncios ainda não estão disponíveis. Remover tokens locais não revoga o consentimento concedido à aplicação no marketplace.
            </p>
          </section>
        );
      })}
    </>
  );
}
