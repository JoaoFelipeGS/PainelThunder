import { PageTitle } from "@/components/page-title";
import { ListingMappings, type ListingConnection, type ListingMapping, type ListingVariant } from "@/components/listing-mappings";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function ListingsPage() {
  const supabase = await createServerSupabase();
  const [{ data: connections, error: connectionsError }, { data: variants, error: variantsError }, { data: listings, error: listingsError }] = await Promise.all([
    supabase
      .from("marketplace_connections")
      .select("id,platform,account_label,external_account_id,status")
      .eq("status", "connected")
      .order("created_at", { ascending: false }),
    supabase
      .from("product_variants")
      .select("id,sku,attributes,products(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("marketplace_listings")
      .select("id,platform,connection_id,external_item_id,external_variant_id,variant_id,platform_stock,status,product_variants(sku,attributes,products(name))")
      .order("updated_at", { ascending: false })
  ]);

  const error = connectionsError ?? variantsError ?? listingsError;
  return (
    <>
      <PageTitle title="Anúncios" subtitle="Vincule anúncios existentes às variações para publicar a disponibilidade do estoque interno." />
      {error
        ? <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">Não foi possível carregar conexões e anúncios: {error.message}</p>
        : <ListingMappings
            connections={(connections ?? []) as ListingConnection[]}
            variants={(variants ?? []) as ListingVariant[]}
            listings={(listings ?? []) as ListingMapping[]}
          />}
    </>
  );
}
