import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { updateMercadoLivreStock } from "@/lib/marketplaces/mercado-livre/client";
import { getMarketplaceAccessToken } from "@/lib/marketplaces/shared/connections";
import { updateShopeeStock } from "@/lib/marketplaces/shopee/client";
import { createAdminSupabase } from "@/lib/supabase/admin";

type MarketplaceSyncJob = {
  id: string;
  user_id: string;
  platform: "mercado_livre" | "shopee";
  payload: unknown;
};

type Listing = {
  id: string;
  user_id: string;
  connection_id: string | null;
  platform: "mercado_livre" | "shopee";
  external_item_id: string;
  external_variant_id: string | null;
  variant_id: string | null;
};

function hasValidSecret(request: NextRequest) {
  const configured = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function listingIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).listing_id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function publishListingStock(job: MarketplaceSyncJob, admin: ReturnType<typeof createAdminSupabase>) {
  const listingId = listingIdFromPayload(job.payload);
  if (!listingId) throw new Error("Tarefa com identificador de anúncio inválido.");

  const { data: listing, error: listingError } = await admin
    .from("marketplace_listings")
    .select("id,user_id,connection_id,platform,external_item_id,external_variant_id,variant_id")
    .eq("id", listingId)
    .eq("user_id", job.user_id)
    .eq("platform", job.platform)
    .maybeSingle();
  if (listingError) throw new Error("Não foi possível carregar o anúncio da tarefa.");
  if (!listing) return;
  const mappedListing = listing as Listing;
  if (!mappedListing.connection_id || !mappedListing.variant_id) return;

  const currentTime = new Date().toISOString();
  const { data: lock, error: lockError } = await admin
    .from("marketplace_listings")
    .update({ sync_lock_until: new Date(Date.now() + 30_000).toISOString() })
    .eq("id", mappedListing.id)
    .eq("user_id", job.user_id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${currentTime}`)
    .select("id")
    .maybeSingle();
  if (lockError) throw new Error("Não foi possível bloquear a atualização do anúncio.");
  if (!lock) throw new Error("Este anúncio já está sendo atualizado; a tarefa será repetida.");

  try {
    const { data: inventory, error: inventoryError } = await admin
      .from("inventory")
      .select("quantity,reserved_quantity")
      .eq("variant_id", mappedListing.variant_id)
      .eq("user_id", job.user_id)
      .maybeSingle();
    if (inventoryError || !inventory) throw new Error("Estoque da variação vinculada não foi encontrado.");
    const quantity = inventory.quantity - inventory.reserved_quantity;
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Disponibilidade calculada inválida.");

    const accessToken = await getMarketplaceAccessToken(job.user_id, mappedListing.connection_id);
    if (mappedListing.platform === "mercado_livre") {
      await updateMercadoLivreStock(
        accessToken,
        mappedListing.external_item_id,
        mappedListing.external_variant_id,
        quantity
      );
    } else {
      const { data: connection, error: connectionError } = await admin
        .from("marketplace_connections")
        .select("external_account_id")
        .eq("id", mappedListing.connection_id)
        .eq("user_id", job.user_id)
        .maybeSingle();
      if (connectionError || !connection?.external_account_id) throw new Error("Loja Shopee da conexão não foi encontrada.");
      await updateShopeeStock(
        accessToken,
        connection.external_account_id,
        mappedListing.external_item_id,
        mappedListing.external_variant_id,
        quantity
      );
    }

    const syncedAt = new Date().toISOString();
    const { error: saveError } = await admin
      .from("marketplace_listings")
      .update({ platform_stock: quantity, last_synced_at: syncedAt })
      .eq("id", mappedListing.id)
      .eq("user_id", job.user_id);
    if (saveError) throw new Error("A plataforma foi atualizada, mas não foi possível registrar a confirmação local.");

    const { error: connectionUpdateError } = await admin
      .from("marketplace_connections")
      .update({ last_synced_at: syncedAt, last_error: null, updated_at: syncedAt })
      .eq("id", mappedListing.connection_id)
      .eq("user_id", job.user_id);
    if (connectionUpdateError) throw new Error("A plataforma foi atualizada, mas o status da conexão não foi salvo.");
  } finally {
    const { error: releaseError } = await admin
      .from("marketplace_listings")
      .update({ sync_lock_until: null })
      .eq("id", mappedListing.id)
      .eq("user_id", job.user_id);
    if (releaseError) throw new Error("Não foi possível liberar o bloqueio do anúncio.");
  }
}

export async function GET(request: NextRequest) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let admin: ReturnType<typeof createAdminSupabase>;
  try {
    admin = createAdminSupabase();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuração do servidor inválida." }, { status: 500 });
  }

  const { data, error } = await admin.rpc("claim_marketplace_sync_jobs", { p_limit: 20 });
  if (error) return NextResponse.json({ error: "Não foi possível obter tarefas de sincronização." }, { status: 500 });
  const jobs = (Array.isArray(data) ? data : []) as MarketplaceSyncJob[];
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await publishListingStock(job, admin);
      const { error: finishError } = await admin.rpc("finish_marketplace_sync_job", {
        p_job_id: job.id,
        p_success: true,
        p_error: null
      });
      if (finishError) throw new Error("Não foi possível confirmar a tarefa concluída.");
      succeeded += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha inesperada ao publicar estoque.";
      const { error: finishError } = await admin.rpc("finish_marketplace_sync_job", {
        p_job_id: job.id,
        p_success: false,
        p_error: detail
      });
      if (finishError) {
        console.error("Falha ao registrar erro de sincronização", { jobId: job.id });
      }
      failed += 1;
    }
  }

  return NextResponse.json(
    { processed: jobs.length, succeeded, failed },
    { headers: { "Cache-Control": "no-store" } }
  );
}
