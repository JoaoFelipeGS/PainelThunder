import { PageTitle } from "@/components/page-title";
import { createServerSupabase } from "@/lib/supabase/server";

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
export default async function FinancePage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("orders").select("platform,status,gross_amount,ordered_at").order("ordered_at", { ascending: false }).limit(1000);
  const orders = (data ?? []).filter(o => !["cancelled","canceled","refunded"].includes((o.status??"").toLowerCase()));
  const total = orders.reduce((s,o)=>s+Number(o.gross_amount??0),0);
  const ml = orders.filter(o=>o.platform==="mercado_livre").reduce((s,o)=>s+Number(o.gross_amount??0),0);
  const sh = orders.filter(o=>o.platform==="shopee").reduce((s,o)=>s+Number(o.gross_amount??0),0);
  return <><PageTitle title="Faturamento" subtitle="Resumo bruto dos pedidos importados. Não representa repasse líquido nem lucro."/>
    {error&&<div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Execute a migration SQL para ativar os relatórios.</div>}
    <div className="grid gap-4 md:grid-cols-3">{[{label:"Faturamento bruto",value:brl(total),desc:"Até 1.000 pedidos recentes"},{label:"Mercado Livre",value:brl(ml),desc:"Pedidos não cancelados"},{label:"Shopee",value:brl(sh),desc:"Pedidos não cancelados"}].map(x=><div key={x.label} className="rounded-2xl border border-line bg-panel p-5"><p className="text-sm text-muted">{x.label}</p><p className="mt-4 text-2xl font-semibold">{x.value}</p><p className="mt-2 text-xs text-muted">{x.desc}</p></div>)}</div>
    <div className="mt-6 rounded-2xl border border-line bg-panel p-5"><h2 className="font-semibold">Sobre os valores</h2><p className="mt-2 text-sm leading-6 text-muted">O cálculo atual é uma primeira versão e considera o valor bruto dos pedidos importados. Antes de usar para decisões financeiras, a integração deve importar comissões, fretes, descontos, reembolsos e repasses quando esses dados estiverem disponíveis. Lucro não é calculado sem esses custos.</p></div>
  </>;
}
