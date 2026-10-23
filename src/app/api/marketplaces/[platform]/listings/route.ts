import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const platformIds: Record<string, "mercado_livre" | "shopee"> = {
  "mercado-livre": "mercado_livre",
  shopee: "shopee"
};

type ListingInput = {
  connectionId: string;
  itemId: string;
  externalVariantId: string | null;
  variantId: string;
};

function parseInput(value: unknown): ListingInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.connectionId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(body.connectionId)
    || typeof body.itemId !== "string"
    || !/^\d+$/.test(body.itemId)
    || typeof body.variantId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(body.variantId)
    || (body.externalVariantId !== null && body.externalVariantId !== undefined
      && (typeof body.externalVariantId !== "string" || !/^\d+$/.test(body.externalVariantId)))
  ) return null;

  return {
    connectionId: body.connectionId,
    itemId: body.itemId,
    externalVariantId: typeof body.externalVariantId === "string" ? body.externalVariantId : null,
    variantId: body.variantId
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform: routePlatform } = await context.params;
  const platform = platformIds[routePlatform];
  if (!platform) return NextResponse.json({ error: "Integração desconhecida." }, { status: 404 });

  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  let input: ListingInput | null;
  try {
    input = parseInput(await request.json());
  } catch {
    input = null;
  }
  if (!input) return NextResponse.json({ error: "Informe conexão, anúncio e variação válidos." }, { status: 400 });

  const { data: connection, error: connectionError } = await supabase
    .from("marketplace_connections")
    .select("id")
    .eq("id", input.connectionId)
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("status", "connected")
    .maybeSingle();
  if (connectionError) return NextResponse.json({ error: "Não foi possível validar a conexão." }, { status: 500 });
  if (!connection) return NextResponse.json({ error: "Conexão ativa não encontrada." }, { status: 404 });

  const { data: variant, error: variantError } = await supabase
    .from("product_variants")
    .select("id")
    .eq("id", input.variantId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (variantError) return NextResponse.json({ error: "Não foi possível validar a variação." }, { status: 500 });
  if (!variant) return NextResponse.json({ error: "Variação não encontrada." }, { status: 404 });

  const listingQuery = supabase
    .from("marketplace_listings")
    .select("id")
    .eq("connection_id", connection.id)
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("external_item_id", input.itemId);
  const { data: existing, error: lookupError } = input.externalVariantId
    ? await listingQuery.eq("external_variant_id", input.externalVariantId).maybeSingle()
    : await listingQuery.is("external_variant_id", null).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Não foi possível verificar o anúncio." }, { status: 500 });

  if (existing) {
    const { error } = await supabase
      .from("marketplace_listings")
      .update({ variant_id: variant.id, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Não foi possível atualizar o vínculo do anúncio." }, { status: 500 });
  } else {
    const { error } = await supabase.from("marketplace_listings").insert({
      user_id: user.id,
      connection_id: connection.id,
      platform,
      external_item_id: input.itemId,
      external_variant_id: input.externalVariantId,
      variant_id: variant.id
    });
    if (error) return NextResponse.json({ error: "Não foi possível cadastrar o vínculo do anúncio." }, { status: 500 });
  }

  return NextResponse.json({ linked: true }, { headers: { "Cache-Control": "no-store" } });
}
