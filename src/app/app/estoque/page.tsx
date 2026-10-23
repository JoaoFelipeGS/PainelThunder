import { PageTitle } from "@/components/page-title";
import { InventoryTable, type InventoryRow } from "@/components/inventory-table";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function InventoryPage() {
  const supabase = await createServerSupabase();
  const [inventoryResult, productsResult, variantsResult] = await Promise.all([
    supabase
      .from("inventory")
      .select("variant_id,quantity,reserved_quantity,min_quantity,updated_at,product_variants(id,sku,attributes,products(name,cost_price))")
      .order("updated_at", { ascending: false }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("product_variants").select("id", { count: "exact", head: true })
  ]);
  const error = inventoryResult.error ?? productsResult.error ?? variantsResult.error;
  const rows = (inventoryResult.data ?? []) as unknown as InventoryRow[];
  const emptyState = productsResult.count === 0
    ? "no-products"
    : variantsResult.count === 0
      ? "no-variants"
      : "missing-inventory";

  return (
    <>
      <PageTitle title="Estoque" subtitle="Disponibilidade, custo estimado e movimentações por variação." />
      {error
        ? <div role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Não foi possível carregar o estoque. Confira a conexão com Supabase e se as migrations estão aplicadas: {error.message}</div>
        : <InventoryTable rows={rows} emptyState={rows.length ? null : emptyState} />}
    </>
  );
}
