"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Package, Plus, Search, X } from "lucide-react";
import { PageTitle } from "@/components/page-title";
import { createClient } from "@/lib/supabase/client";

type Product = {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  cost_price: number;
  default_price: number;
  active: boolean;
  created_at: string;
};

type VariantDraft = {
  key: string;
  sku: string;
  size: string;
  color: string;
  initial_quantity: string;
  min_quantity: string;
};

type ExistingVariant = {
  id: string;
  sku: string | null;
  attributes: Record<string, string>;
  inventory: { quantity: number; min_quantity: number } | { quantity: number; min_quantity: number }[] | null;
};

type ProductForm = {
  name: string;
  sku: string;
  cost_price: string;
  default_price: string;
  description: string;
  variants: VariantDraft[];
};

const emptyVariant = (): VariantDraft => ({
  key: `${Date.now()}-${Math.random()}`,
  sku: "",
  size: "",
  color: "",
  initial_quantity: "0",
  min_quantity: "0"
});

const emptyForm = (): ProductForm => ({
  name: "",
  sku: "",
  cost_price: "0",
  default_price: "0",
  description: "",
  variants: [emptyVariant()]
});

const inputClass = "mt-2 w-full rounded-xl border border-line bg-ink px-3 py-2.5 outline-none focus:border-accent";

export default function ProductsPage() {
  const [rows, setRows] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [existingVariants, setExistingVariants] = useState<ExistingVariant[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const requestId = useRef<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("products")
        .select("id,sku,name,description,cost_price,default_price,active,created_at")
        .order("created_at", { ascending: false });

      if (loadError) setError(loadError.message);
      else setRows((data ?? []) as Product[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os produtos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startCreate() {
    setEditing(null);
    setExistingVariants([]);
    setForm(emptyForm());
    requestId.current = null;
    setError("");
    setShowForm(true);
  }

  async function startEdit(product: Product) {
    setError("");
    try {
      const supabase = createClient();
      const { data, error: variantsError } = await supabase
        .from("product_variants")
        .select("id,sku,attributes,inventory(quantity,min_quantity)")
        .eq("product_id", product.id)
        .order("created_at", { ascending: true });

      if (variantsError) {
        setError(`Não foi possível carregar as variações: ${variantsError.message}`);
        return;
      }

      setEditing(product);
      setExistingVariants((data ?? []) as ExistingVariant[]);
      setForm({
        name: product.name,
        sku: product.sku ?? "",
        cost_price: String(product.cost_price),
        default_price: String(product.default_price),
        description: product.description ?? "",
        variants: []
      });
      requestId.current = null;
      setShowForm(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar as variações.");
      return;
    }
  }

  function updateVariant(key: string, field: keyof Omit<VariantDraft, "key">, value: string) {
    setForm(current => ({
      ...current,
      variants: current.variants.map(variant =>
        variant.key === key ? { ...variant, [field]: value } : variant
      )
    }));
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const cost = Number(form.cost_price);
    const price = Number(form.default_price);
    const variants = form.variants.map((variant, index) => ({
      sku: variant.sku.trim() || (!editing && form.variants.length === 1 && index === 0 ? form.sku.trim() : ""),
      size: variant.size.trim(),
      color: variant.color.trim(),
      initial_quantity: Number(variant.initial_quantity),
      min_quantity: Number(variant.min_quantity)
    }));

    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(price) || price < 0) {
      setError("Custo e preço devem ser valores válidos e não negativos.");
      setSaving(false);
      return;
    }
    if (variants.some(variant =>
      !Number.isInteger(variant.initial_quantity) || variant.initial_quantity < 0
      || !Number.isInteger(variant.min_quantity) || variant.min_quantity < 0
    )) {
      setError("Estoque inicial e mínimo devem ser números inteiros não negativos.");
      setSaving(false);
      return;
    }

    if (!editing && !requestId.current) requestId.current = crypto.randomUUID();
    try {
      const supabase = createClient();
      const { error: saveError } = await supabase.rpc("save_product_with_variants", {
        p_product_id: editing?.id ?? null,
        p_request_id: editing ? null : requestId.current,
        p_name: form.name.trim(),
        p_sku: form.sku.trim() || null,
        p_description: form.description.trim() || null,
        p_cost_price: cost,
        p_default_price: price,
        p_variants: variants
      });

      if (saveError) {
        setError(`Não foi possível salvar o produto: ${saveError.message}`);
        setSaving(false);
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o produto.");
      setSaving(false);
      return;
    }

    requestId.current = null;
    setShowForm(false);
    setEditing(null);
    await load();
    setSaving(false);
  }

  const filtered = rows.filter(product =>
    `${product.name} ${product.sku ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );
  const brl = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  return (
    <>
      <PageTitle
        title="Produtos"
        subtitle="Catálogo interno, custos, preços e variações com estoque."
        action={
          <button onClick={startCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium hover:bg-indigo-500">
            <Plus size={17} /> Novo produto
          </button>
        }
      />

      {showForm && (
        <form onSubmit={saveProduct} className="mb-6 rounded-2xl border border-line bg-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{editing ? "Editar produto e adicionar variações" : "Cadastrar produto e estoque inicial"}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-muted hover:text-white" aria-label="Fechar formulário">
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-gray-300">
              Nome *
              <input required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={inputClass} />
            </label>
            <label className="text-sm text-gray-300">
              SKU / código interno
              <input maxLength={120} value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })} className={inputClass} placeholder="Ex.: CAM-001" />
            </label>
            <label className="text-sm text-gray-300">
              Custo unitário (R$)
              <input type="number" min="0" step="0.01" required value={form.cost_price} onChange={event => setForm({ ...form, cost_price: event.target.value })} className={inputClass} />
            </label>
            <label className="text-sm text-gray-300">
              Preço de venda padrão (R$)
              <input type="number" min="0" step="0.01" required value={form.default_price} onChange={event => setForm({ ...form, default_price: event.target.value })} className={inputClass} />
            </label>
            <label className="text-sm text-gray-300 sm:col-span-2">
              Descrição
              <textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows={2} className={inputClass} />
            </label>
          </div>

          {editing && (
            <div className="mt-5">
              <h3 className="text-sm font-medium">Variações existentes</h3>
              {existingVariants.length ? (
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {existingVariants.map(variant => {
                    const stock = Array.isArray(variant.inventory) ? variant.inventory[0] : variant.inventory;
                    const attributes = Object.values(variant.attributes ?? {}).filter(Boolean).join(" / ");
                    return (
                      <li key={variant.id}>
                        {variant.sku || "Sem SKU"}{attributes ? ` — ${attributes}` : " — sem tamanho/cor"}; estoque {stock?.quantity ?? "não inicializado"}; mínimo {stock?.min_quantity ?? "—"}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="mt-2 text-sm text-muted">Este produto ainda não tem variações. Adicione uma abaixo.</p>}
            </div>
          )}

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{editing ? "Adicionar variações" : "Variações e estoque"}</h3>
                <p className="mt-1 text-xs text-muted">Tamanho e cor são opcionais. Para produto simples, mantenha ambos vazios e use uma variação.</p>
              </div>
              <button type="button" onClick={() => setForm(current => ({ ...current, variants: [...current.variants, emptyVariant()] }))} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/[.05]">
                <Plus size={14} /> Adicionar
              </button>
            </div>
            <div className="space-y-3">
              {editing && form.variants.length === 0 && <p className="text-sm text-muted">Nenhuma nova variação será criada; as existentes permanecerão inalteradas.</p>}
              {form.variants.map((variant, index) => (
                <div key={variant.key} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-6">
                  <label className="text-xs text-muted">
                    SKU da variação
                    <input maxLength={120} value={variant.sku} onChange={event => updateVariant(variant.key, "sku", event.target.value)} className={inputClass} placeholder={!editing && index === 0 && form.variants.length === 1 ? "Usa o SKU do produto" : "Opcional"} />
                  </label>
                  <label className="text-xs text-muted">
                    Tamanho (opcional)
                    <input maxLength={80} value={variant.size} onChange={event => updateVariant(variant.key, "size", event.target.value)} className={inputClass} placeholder="PP, P, M, G, GG ou personalizado" />
                  </label>
                  <label className="text-xs text-muted">
                    Cor (opcional)
                    <input maxLength={100} value={variant.color} onChange={event => updateVariant(variant.key, "color", event.target.value)} className={inputClass} placeholder="Ex.: preta" />
                  </label>
                  <label className="text-xs text-muted">
                    Estoque inicial
                    <input type="number" min="0" step="1" required value={variant.initial_quantity} onChange={event => updateVariant(variant.key, "initial_quantity", event.target.value)} className={inputClass} />
                  </label>
                  <label className="text-xs text-muted">
                    Mínimo para alerta
                    <input type="number" min="0" step="1" required value={variant.min_quantity} onChange={event => updateVariant(variant.key, "min_quantity", event.target.value)} className={inputClass} />
                  </label>
                  <div className="flex items-end justify-end">
                    <button type="button" disabled={form.variants.length === 1} onClick={() => setForm(current => ({ ...current, variants: current.variants.filter(item => item.key !== variant.key) }))} className="mb-1 rounded-lg p-2 text-muted hover:bg-white/[.05] hover:text-white disabled:opacity-30" aria-label="Remover variação">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <div className="mt-4 flex justify-end">
            <button disabled={saving} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50">
              {saving ? "Salvando..." : "Salvar produto"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-panel px-3">
        <Search size={17} className="text-muted" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou SKU..." className="w-full bg-transparent py-3 text-sm outline-none" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>{["Produto", "SKU", "Custo", "Preço", "Situação", ""].map(heading => <th key={heading} className="px-5 py-4 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map(product => (
                <tr key={product.id} className="hover:bg-white/[.02]">
                  <td className="px-5 py-4 font-medium">{product.name}<p className="mt-1 max-w-xs truncate text-xs font-normal text-muted">{product.description || "Sem descrição"}</p></td>
                  <td className="px-5 py-4 text-muted">{product.sku || "—"}</td>
                  <td className="px-5 py-4">{brl(Number(product.cost_price))}</td>
                  <td className="px-5 py-4">{brl(Number(product.default_price))}</td>
                  <td className="px-5 py-4"><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">{product.active ? "Ativo" : "Inativo"}</span></td>
                  <td className="px-5 py-4">
                    <button onClick={() => void startEdit(product)} className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/[.05]">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="p-8 text-center text-sm text-muted">Carregando produtos...</p>}
        {!loading && filtered.length === 0 && (
          <div className="px-5 py-14 text-center">
            <Package className="mx-auto mb-3 text-muted" size={28} />
            <p className="font-medium">{rows.length ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}</p>
            <p className="mt-1 text-sm text-muted">{rows.length ? "Tente outro nome ou SKU." : "Cadastre um produto para criar sua primeira variação e estoque."}</p>
          </div>
        )}
      </div>
    </>
  );
}
