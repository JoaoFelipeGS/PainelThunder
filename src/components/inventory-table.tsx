"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type InventoryRow = {
  variant_id: string;
  quantity: number;
  reserved_quantity: number;
  min_quantity: number;
  updated_at: string;
  product_variants: {
    id: string;
    sku: string | null;
    attributes: Record<string, string>;
    products: { name: string; cost_price: number } | null;
  } | null;
};

type Movement = {
  id: string;
  movement_type: string;
  quantity_delta: number;
  reason: string | null;
  created_at: string;
};

type Operation = "in" | "out" | "adjustment";
type EmptyState = "no-products" | "no-variants" | "missing-inventory" | null;

const operationLabels: Record<Operation, string> = {
  in: "Registrar entrada",
  out: "Registrar saída",
  adjustment: "Ajuste manual"
};

const movementLabels: Record<string, string> = {
  in: "Entrada",
  out: "Saída",
  adjustment: "Ajuste",
  reserve: "Reserva",
  release: "Liberação",
  sale: "Venda",
  return: "Devolução"
};

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function InventoryTable({
  rows: initial,
  emptyState
}: {
  rows: InventoryRow[];
  emptyState: EmptyState;
}) {
  const [rows, setRows] = useState(initial);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "zero">("all");
  const [operation, setOperation] = useState<{ variantId: string; type: Operation; requestId: string } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<{ variantId: string; loading: boolean; error: string; movements: Movement[] } | null>(null);

  function openOperation(row: InventoryRow, type: Operation) {
    setOperation({ variantId: row.variant_id, type, requestId: crypto.randomUUID() });
    setQuantity("");
    setReason("");
    setMessage("");
  }

  async function saveOperation() {
    if (!operation) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount === 0 || (operation.type !== "adjustment" && amount < 0)) {
      setMessage(operation.type === "adjustment" ? "Informe um ajuste inteiro diferente de zero." : "Informe uma quantidade inteira maior que zero.");
      return;
    }
    if (!reason.trim()) {
      setMessage("Informe uma justificativa para a movimentação.");
      return;
    }

    const row = rows.find(item => item.variant_id === operation.variantId);
    if (!row) {
      setMessage("A variação selecionada não está mais disponível. Atualize a página.");
      return;
    }
    const delta = operation.type === "out" ? -amount : amount;
    if (row.quantity + delta < row.reserved_quantity || row.quantity + delta < 0) {
      setMessage("A quantidade resultante não pode ficar abaixo do estoque reservado nem negativa.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("move_inventory", {
        p_variant_id: operation.variantId,
        p_delta: delta,
        p_reason: reason.trim(),
        p_movement_type: operation.type,
        p_request_id: operation.requestId
      });

      if (error) {
        setMessage(`Não foi possível atualizar o estoque: ${error.message}`);
        setBusy(false);
        return;
      }

      const updated = data as unknown as { quantity: number; reserved_quantity: number; min_quantity: number; updated_at: string } | null;
      if (!updated || !Number.isInteger(updated.quantity)) {
        setMessage("A operação retornou sem a quantidade atualizada. O identificador foi preservado; atualize a página antes de tentar novamente.");
        setBusy(false);
        return;
      }

      setRows(current => current.map(item =>
        item.variant_id === operation.variantId
          ? { ...item, quantity: updated.quantity, reserved_quantity: updated.reserved_quantity, min_quantity: updated.min_quantity, updated_at: updated.updated_at }
          : item
      ));
      setHistory(null);
      setOperation(null);
      setQuantity("");
      setReason("");
      setMessage("Movimentação registrada e estoque atualizado.");
    } catch (caught) {
      setMessage(caught instanceof Error ? `Não foi possível atualizar o estoque: ${caught.message}` : "Não foi possível atualizar o estoque.");
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(variantId: string) {
    setHistory({ variantId, loading: true, error: "", movements: [] });
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id,movement_type,quantity_delta,reason,created_at")
        .eq("variant_id", variantId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) setHistory({ variantId, loading: false, error: error.message, movements: [] });
      else setHistory({ variantId, loading: false, error: "", movements: (data ?? []) as Movement[] });
    } catch (caught) {
      setHistory({ variantId, loading: false, error: caught instanceof Error ? caught.message : "Não foi possível carregar o histórico.", movements: [] });
    }
  }

  const filtered = rows.filter(row => {
    const variant = row.product_variants;
    const available = row.quantity - row.reserved_quantity;
    const matchesSearch = `${variant?.products?.name ?? ""} ${variant?.sku ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesFilter = filter === "all"
      || (filter === "zero" ? available <= 0 : available > 0 && available <= row.min_quantity);
    return matchesSearch && matchesFilter;
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      {rows.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por produto ou SKU..." className="min-w-0 flex-1 rounded-xl border border-line bg-ink px-3 py-2.5 text-sm outline-none focus:border-accent" />
          <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm outline-none focus:border-accent" aria-label="Filtrar estoque">
            <option value="all">Todos os estoques</option>
            <option value="low">Estoque baixo</option>
            <option value="zero">Estoque zerado</option>
          </select>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="font-medium">
            {emptyState === "no-products" ? "Nenhum produto cadastrado" : emptyState === "no-variants" ? "Os produtos ainda não têm variações" : "Variações sem registro de estoque"}
          </p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
            {emptyState === "no-products"
              ? "Cadastre um produto em Produtos. O formulário criará uma variação e o respectivo registro de estoque."
              : emptyState === "no-variants"
                ? "Edite um produto e adicione uma variação, mesmo que tamanho e cor não se apliquem."
                : "Edite o produto para criar variações e inicializar seu estoque. Nenhuma quantidade foi simulada."}
          </p>
          <a href="/app/produtos" className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-medium hover:bg-indigo-500">Ir para Produtos</a>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>{["Produto / SKU", "Tamanho / cor", "Disponível", "Mínimo", "Custo unitário", "Valor estimado", "Situação", "Ações"].map(heading => <th key={heading} className="px-4 py-4 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(row => {
                  const variant = row.product_variants;
                  const attributes = Object.values(variant?.attributes ?? {}).filter(Boolean).join(" / ");
                  const available = row.quantity - row.reserved_quantity;
                  const cost = Number(variant?.products?.cost_price ?? 0);
                  const status = available <= 0 ? "Zerado" : available <= row.min_quantity ? "Estoque baixo" : "Normal";
                  const statusClass = available <= 0 ? "bg-red-500/10 text-red-200" : available <= row.min_quantity ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200";
                  return (
                    <tr key={row.variant_id} className="align-top hover:bg-white/[.02]">
                      <td className="px-4 py-4 font-medium">{variant?.products?.name ?? "Produto"}<p className="mt-1 text-xs font-normal text-muted">{variant?.sku ?? "Sem SKU"} · físico {row.quantity} · reservado {row.reserved_quantity}</p></td>
                      <td className="px-4 py-4 text-muted">{attributes || "—"}</td>
                      <td className="px-4 py-4 font-semibold">{available}</td>
                      <td className="px-4 py-4">{row.min_quantity}</td>
                      <td className="px-4 py-4">{brl(cost)}</td>
                      <td className="px-4 py-4">{brl(row.quantity * cost)}</td>
                      <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${statusClass}`}>{status}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button disabled={busy} onClick={() => openOperation(row, "in")} className="rounded-lg border border-line px-2.5 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">Entrada</button>
                          <button disabled={busy} onClick={() => openOperation(row, "out")} className="rounded-lg border border-line px-2.5 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">Saída</button>
                          <button disabled={busy} onClick={() => openOperation(row, "adjustment")} className="rounded-lg border border-line px-2.5 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">Ajustar</button>
                          <button disabled={busy} onClick={() => void loadHistory(row.variant_id)} className="rounded-lg border border-line px-2.5 py-2 text-xs hover:bg-white/[.05] disabled:opacity-50">Histórico</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted">Nenhuma variação corresponde à busca ou ao filtro selecionado.</p>}

          {operation && (
            <div className="border-t border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium">{operationLabels[operation.type]}</h3>
                <button onClick={() => setOperation(null)} className="text-sm text-muted hover:text-white">Cancelar</button>
              </div>
              <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                <label className="text-xs text-muted">
                  {operation.type === "adjustment" ? "Quantidade (+/-)" : "Quantidade"}
                  <input type="number" step="1" min={operation.type === "adjustment" ? undefined : "1"} value={quantity} onChange={event => setQuantity(event.target.value)} placeholder={operation.type === "adjustment" ? "+5 ou -2" : "Quantidade inteira"} className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent" />
                </label>
                <label className="text-xs text-muted">
                  Justificativa
                  <input required value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Ex.: recebimento de compra ou contagem física" className="mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent" />
                </label>
                <button onClick={() => void saveOperation()} disabled={busy} className="self-end rounded-xl bg-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Salvando..." : "Confirmar"}</button>
              </div>
            </div>
          )}

          {history && (
            <div className="border-t border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium">Histórico de movimentações</h3>
                <button onClick={() => setHistory(null)} className="text-sm text-muted hover:text-white">Fechar</button>
              </div>
              {history.loading ? <p className="text-sm text-muted">Carregando movimentações...</p>
                : history.error ? <p role="alert" className="text-sm text-red-300">Não foi possível carregar o histórico: {history.error}</p>
                  : history.movements.length ? (
                    <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                      {history.movements.map(movement => (
                        <li key={movement.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <span>{movementLabels[movement.movement_type] ?? movement.movement_type}: <strong className={movement.quantity_delta > 0 ? "text-emerald-200" : "text-amber-200"}>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}</strong>{movement.reason ? ` · ${movement.reason}` : ""}</span>
                          <time className="text-xs text-muted">{new Date(movement.created_at).toLocaleString("pt-BR")}</time>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Nenhuma movimentação registrada.</p>}
            </div>
          )}
        </>
      )}
      {message && <p role="status" className="border-t border-line px-4 py-3 text-sm text-muted">{message}</p>}
    </section>
  );
}
