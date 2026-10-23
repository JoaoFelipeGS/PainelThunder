import { PageTitle } from "@/components/page-title";
import { createServerSupabase } from "@/lib/supabase/server";
import { ShoppingCart } from "lucide-react";

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const platformLabel = (p: string) => p === "mercado_livre" ? "Mercado Livre" : p === "shopee" ? "Shopee" : p;

export default async function OrdersPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("orders").select("id,platform,external_order_id,status,ordered_at,gross_amount,currency").order("ordered_at", { ascending: false }).limit(200);
  return <><PageTitle title="Pedidos" subtitle="Pedidos importados das plataformas, sem duplicações."/>
    {error ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Não foi possível carregar pedidos. Execute a migration SQL.</div> : <div className="overflow-hidden rounded-2xl border border-line bg-panel"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr>{["Plataforma","Pedido","Data","Status","Valor bruto"].map(x=><th key={x} className="px-5 py-4 font-medium">{x}</th>)}</tr></thead><tbody className="divide-y divide-line">{(data??[]).map(o=><tr key={o.id} className="hover:bg-white/[.02]"><td className="px-5 py-4">{platformLabel(o.platform)}</td><td className="px-5 py-4 font-mono text-xs">{o.external_order_id}</td><td className="px-5 py-4 text-muted">{o.ordered_at?new Date(o.ordered_at).toLocaleString("pt-BR"):"—"}</td><td className="px-5 py-4"><span className="rounded-full bg-white/[.06] px-2.5 py-1 text-xs">{o.status}</span></td><td className="px-5 py-4">{brl(Number(o.gross_amount??0))}</td></tr>)}</tbody></table></div>{!data?.length&&<div className="px-5 py-14 text-center"><ShoppingCart className="mx-auto mb-3 text-muted" size={28}/><p className="font-medium">Nenhum pedido importado</p><p className="mt-1 text-sm text-muted">Conecte uma plataforma e execute a primeira sincronização.</p></div>}</div>}
  </>;
}
