import { Package, ShoppingCart, CircleDollarSign, AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react";
import { PageTitle } from "@/components/page-title";
import { createServerSupabase } from "@/lib/supabase/server";

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const [{ count: productsCount }, { count: ordersCount }, { data: inventory }, { data: orders }] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }).eq("active", true),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("inventory").select("quantity,reserved_quantity,min_quantity"),
    supabase.from("orders").select("gross_amount,status").order("ordered_at", { ascending: false }).limit(100)
  ]);

  const lowStock = (inventory ?? []).filter((item) => item.quantity - item.reserved_quantity <= item.min_quantity).length;
  const validOrders = (orders ?? []).filter((o) => !["cancelled", "canceled", "refunded"].includes((o.status ?? "").toLowerCase()));
  const gross = validOrders.reduce((sum, o) => sum + Number(o.gross_amount ?? 0), 0);
  const metrics = [
    { label: "Faturamento importado", value: brl(gross), note: "Últimos 100 pedidos carregados", icon: CircleDollarSign },
    { label: "Pedidos registrados", value: String(ordersCount ?? 0), note: "Todos os status", icon: ShoppingCart },
    { label: "Produtos ativos", value: String(productsCount ?? 0), note: "Catálogo interno", icon: Package },
    { label: "Estoque baixo", value: String(lowStock), note: "No limite ou abaixo", icon: AlertTriangle }
  ];

  return <><PageTitle title="Visão geral" subtitle="Resumo da operação. Os indicadores serão preenchidos conforme seus dados forem cadastrados e sincronizados." action={<div className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted"><RefreshCw size={14}/> Dados do banco</div>}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon }) => <div key={label} className="rounded-2xl border border-line bg-panel p-5 shadow-soft"><div className="flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Icon size={18} className="text-accent"/></div><p className="mt-5 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs text-muted">{note}</p></div>)}</div>
    <div className="mt-6 grid gap-4 xl:grid-cols-3">
      <section className="rounded-2xl border border-line bg-panel p-6 xl:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Comece por aqui</h2><p className="mt-1 text-sm text-muted">Configure a base antes de ativar a sincronização.</p></div><ArrowUpRight size={18} className="text-muted"/></div><div className="mt-5 space-y-3">{["Criar as tabelas executando a migration SQL do projeto no Supabase","Cadastrar produtos e suas variações com SKU interno","Conectar as contas do Mercado Livre e da Shopee","Importar pedidos e conferir os valores financeiros"].map((s,i)=><div key={s} className="flex gap-3 rounded-xl border border-line/80 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-xs font-semibold text-indigo-200">{i+1}</span><p className="text-sm text-gray-300">{s}</p></div>)}</div></section>
      <section className="rounded-2xl border border-line bg-panel p-6"><h2 className="font-semibold">Status das integrações</h2><p className="mt-1 text-sm text-muted">As conexões ainda não estão ativadas.</p><div className="mt-5 space-y-3">{[{name:"Mercado Livre",desc:"OAuth e API oficial"},{name:"Shopee",desc:"Open Platform"}].map(x=><div key={x.name} className="flex items-center justify-between rounded-xl border border-line p-3"><div><p className="text-sm font-medium">{x.name}</p><p className="mt-1 text-xs text-muted">{x.desc}</p></div><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">Pendente</span></div>)}</div><p className="mt-5 text-xs leading-5 text-muted">Nenhum dado de marketplace é simulado. Os valores refletem apenas registros existentes no banco.</p></section>
    </div>
  </>;
}
