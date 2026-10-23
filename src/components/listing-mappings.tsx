"use client";

import { useState, type FormEvent } from "react";

export type ListingConnection = {
  id: string;
  platform: "mercado_livre" | "shopee";
  account_label: string | null;
  external_account_id: string | null;
  status: string;
};

export type ListingVariant = {
  id: string;
  sku: string | null;
  attributes: Record<string, string>;
  products: { name: string } | { name: string }[] | null;
};

export type ListingMapping = {
  id: string;
  platform: "mercado_livre" | "shopee";
  connection_id: string | null;
  external_item_id: string;
  external_variant_id: string | null;
  variant_id: string | null;
  platform_stock: number | null;
  status: string | null;
  product_variants: ListingVariant | ListingVariant[] | null;
};

const platformPath = {
  mercado_livre: "mercado-livre",
  shopee: "shopee"
} as const;

function platformName(platform: ListingConnection["platform"]) {
  return platform === "mercado_livre" ? "Mercado Livre" : "Shopee";
}

function productName(variant: ListingVariant) {
  const product = Array.isArray(variant.products) ? variant.products[0] : variant.products;
  const attrs = Object.values(variant.attributes ?? {}).filter(Boolean).join(" / ");
  return `${product?.name ?? "Produto"}${attrs ? ` — ${attrs}` : ""}${variant.sku ? ` (${variant.sku})` : ""}`;
}

function linkedVariant(listing: ListingMapping) {
  return Array.isArray(listing.product_variants) ? listing.product_variants[0] : listing.product_variants;
}

export function ListingMappings({
  connections,
  variants,
  listings: initialListings
}: {
  connections: ListingConnection[];
  variants: ListingVariant[];
  listings: ListingMapping[];
}) {
  const [listings, setListings] = useState(initialListings);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [itemId, setItemId] = useState("");
  const [externalVariantId, setExternalVariantId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connection = connections.find(item => item.id === connectionId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection) {
      setError("Conecte uma conta de marketplace antes de vincular anúncios.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/marketplaces/${platformPath[connection.platform]}/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          itemId: itemId.trim(),
          externalVariantId: externalVariantId.trim() || null,
          variantId
        })
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Não foi possível vincular o anúncio.";
        throw new Error(detail);
      }

      const variant = variants.find(item => item.id === variantId);
      if (variant) {
        setListings(current => {
          const existing = current.find(listing =>
            listing.connection_id === connectionId
            && listing.external_item_id === itemId.trim()
            && listing.external_variant_id === (externalVariantId.trim() || null)
          );
          if (existing) {
            return current.map(listing => listing.id === existing.id
              ? { ...listing, variant_id: variant.id, product_variants: variant }
              : listing);
          }
          return [{
            id: crypto.randomUUID(),
            platform: connection.platform,
            connection_id: connectionId,
            external_item_id: itemId.trim(),
            external_variant_id: externalVariantId.trim() || null,
            variant_id: variant.id,
            platform_stock: null,
            status: null,
            product_variants: variant
          }, ...current];
        });
      }
      setMessage("Anúncio vinculado. A próxima alteração de estoque será publicada automaticamente.");
      setItemId("");
      setExternalVariantId("");
      setVariantId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível vincular o anúncio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="font-semibold">Vincular anúncio existente</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Informe o ID do anúncio e, se ele tiver variação, o ID da variação/modelo. Confira os IDs no painel do marketplace antes de salvar. O sistema não cria anúncios novos nem importa o catálogo automaticamente nesta etapa.
        </p>
        {!connections.length || !variants.length
          ? <p className="mt-4 rounded-xl border border-line p-3 text-sm text-muted">
              {!connections.length ? "Conecte uma conta em Configurações." : "Cadastre ao menos um produto e uma variação."}
            </p>
          : (
            <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-300">
                Conta conectada
                <select value={connectionId} onChange={event => setConnectionId(event.target.value)} required className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5">
                  {connections.map(item => <option key={item.id} value={item.id}>{platformName(item.platform)} — {item.account_label || item.external_account_id}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-300">
                Anúncio ID
                <input value={itemId} onChange={event => setItemId(event.target.value)} inputMode="numeric" pattern="[0-9]+" required className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5" />
              </label>
              <label className="text-sm text-gray-300">
                ID da variação/modelo (opcional)
                <input value={externalVariantId} onChange={event => setExternalVariantId(event.target.value)} inputMode="numeric" pattern="[0-9]*" className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5" />
              </label>
              <label className="text-sm text-gray-300">
                Variação interna
                <select value={variantId} onChange={event => setVariantId(event.target.value)} required className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5">
                  <option value="">Selecione a variação</option>
                  {variants.map(item => <option key={item.id} value={item.id}>{productName(item)}</option>)}
                </select>
              </label>
              <button disabled={busy} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50 sm:col-span-2">
                {busy ? "Salvando vínculo..." : "Vincular anúncio"}
              </button>
            </form>
          )}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {message && <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="border-b border-line p-5">
          <h2 className="font-semibold">Anúncios vinculados</h2>
          <p className="mt-1 text-sm text-muted">A quantidade publicada é calculada como estoque físico menos unidades reservadas.</p>
        </div>
        {!listings.length
          ? <p className="p-8 text-center text-sm text-muted">Nenhum anúncio vinculado ainda.</p>
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>{["Plataforma", "Anúncio", "Variação externa", "Produto interno", "Último estoque publicado", "Status"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {listings.map(listing => {
                    const variant = linkedVariant(listing);
                    return (
                      <tr key={listing.id}>
                        <td className="px-4 py-3">{platformName(listing.platform)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{listing.external_item_id}</td>
                        <td className="px-4 py-3 font-mono text-xs">{listing.external_variant_id || "—"}</td>
                        <td className="px-4 py-3">{variant ? productName(variant) : "Variação não vinculada"}</td>
                        <td className="px-4 py-3">{listing.platform_stock ?? "Pendente"}</td>
                        <td className="px-4 py-3">{listing.status || "Vinculado"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
      </section>
    </div>
  );
}
