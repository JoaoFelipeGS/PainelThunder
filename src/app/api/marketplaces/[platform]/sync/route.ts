import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const platformIds: Record<string, "mercado_livre" | "shopee"> = {
  "mercado-livre": "mercado_livre",
  shopee: "shopee"
};

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  }
  const connectionId = body && typeof body === "object" && "connectionId" in body
    ? body.connectionId
    : null;
  if (typeof connectionId !== "string" || !/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return NextResponse.json({ error: "Conexão inválida." }, { status: 400 });
  }

  try {
    const admin = createAdminSupabase();
    const { data: connection, error: connectionError } = await admin
      .from("marketplace_connections")
      .select("id")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", platform)
      .eq("status", "connected")
      .maybeSingle();
    if (connectionError) throw new Error("Não foi possível validar a conexão.");
    if (!connection) return NextResponse.json({ error: "Conexão ativa não encontrada." }, { status: 404 });

    const { data: listings, error: listingsError } = await admin
      .from("marketplace_listings")
      .select("id,variant_id")
      .eq("connection_id", connection.id)
      .eq("user_id", user.id)
      .not("variant_id", "is", null)
      .or("status.is.null,status.neq.closed");
    if (listingsError) throw new Error("Não foi possível carregar anúncios vinculados.");
    if (!listings?.length) {
      return NextResponse.json(
        { error: "Vincule pelo menos um anúncio a uma variação antes de sincronizar o estoque." },
        { status: 409 }
      );
    }

    const jobs = listings.map(listing => ({
      user_id: user.id,
      platform,
      job_type: "publish_inventory",
      payload: { listing_id: listing.id, variant_id: listing.variant_id }
    }));
    const { error: enqueueError } = await admin.from("sync_jobs").insert(jobs);
    if (enqueueError) throw new Error("Não foi possível agendar a publicação do estoque.");

    return NextResponse.json({ queued: jobs.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível agendar a sincronização." },
      { status: 500 }
    );
  }
}
