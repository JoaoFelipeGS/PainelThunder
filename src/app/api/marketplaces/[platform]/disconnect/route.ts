import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const platformIds: Record<string, string> = {
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
  if (!body || typeof body !== "object" || !("connectionId" in body) || typeof body.connectionId !== "string") {
    return NextResponse.json({ error: "Conexão inválida." }, { status: 400 });
  }

  try {
    const admin = createAdminSupabase();
    const { data: connection, error: lookupError } = await admin
      .from("marketplace_connections")
      .select("id,user_id,platform")
      .eq("id", body.connectionId)
      .eq("user_id", user.id)
      .eq("platform", platform)
      .maybeSingle();

    if (lookupError) throw new Error("Não foi possível validar a conexão.");
    if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });

    const { data, error } = await admin.rpc("disconnect_marketplace_connection", {
      p_user_id: user.id,
      p_connection_id: connection.id
    });
    if (error || data !== true) throw new Error("Não foi possível remover as credenciais locais.");
    return NextResponse.json({ disconnected: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível remover a conexão local." }, { status: 500 });
  }
}
