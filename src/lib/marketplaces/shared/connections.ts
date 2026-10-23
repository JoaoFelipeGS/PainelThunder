import "server-only";
import { refreshMercadoLivreToken } from "@/lib/marketplaces/mercado-livre/client";
import { refreshShopeeToken } from "@/lib/marketplaces/shopee/client";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decryptMarketplaceToken, encryptMarketplaceToken, type MarketplacePlatform } from "./security";

export type StoredMarketplaceToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

export async function storeMarketplaceConnection(input: {
  userId: string;
  platform: MarketplacePlatform;
  accountId: string;
  accountLabel: string;
  token: StoredMarketplaceToken;
}) {
  if (!/^\d+$/.test(input.accountId)) throw new Error("Identificador de conta inválido.");
  if (!input.token.access_token || !input.token.refresh_token) throw new Error("A API não retornou os dois tokens esperados.");
  if (!Number.isFinite(input.token.expires_in) || input.token.expires_in <= 0 || input.token.expires_in > 31_536_000) {
    throw new Error("A API retornou uma validade de token inválida.");
  }

  const expiresAt = new Date(Date.now() + input.token.expires_in * 1000).toISOString();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("store_marketplace_connection", {
    p_user_id: input.userId,
    p_platform: input.platform,
    p_external_account_id: input.accountId,
    p_account_label: input.accountLabel,
    p_access_token_ciphertext: encryptMarketplaceToken(input.token.access_token),
    p_refresh_token_ciphertext: encryptMarketplaceToken(input.token.refresh_token),
    p_expires_at: expiresAt,
    p_token_type: input.token.token_type ?? null,
    p_scope: input.token.scope ?? null
  });
  if (error) throw new Error("Não foi possível salvar a conexão com segurança.");
  if (typeof data !== "string") throw new Error("A gravação da conexão retornou um identificador inválido.");
  return data;
}

export async function getMarketplaceAccessToken(userId: string, connectionId: string): Promise<string> {
  const supabase = createAdminSupabase();
  const { data: connection, error: connectionError } = await supabase
    .from("marketplace_connections")
    .select("id,user_id,platform,external_account_id,status")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (connectionError || !connection || connection.status !== "connected" || !connection.external_account_id) {
    throw new Error("Conexão não encontrada ou desconectada.");
  }

  const { data: stored, error: tokenError } = await supabase
    .from("marketplace_connection_secrets")
    .select("access_token_ciphertext,refresh_token_ciphertext,expires_at,token_type,scope,refresh_lock_until")
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (tokenError || !stored) throw new Error("Credenciais cifradas da conexão não encontradas.");

  if (Date.parse(stored.expires_at) > Date.now() + 60_000) {
    return decryptMarketplaceToken(stored.access_token_ciphertext);
  }

  const lockTime = new Date().toISOString();
  const { data: lock, error: lockError } = await supabase
    .from("marketplace_connection_secrets")
    .update({ refresh_lock_until: new Date(Date.now() + 30_000).toISOString() })
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${lockTime}`)
    .select("connection_id")
    .maybeSingle();
  if (lockError) throw new Error("Não foi possível adquirir o bloqueio de renovação.");

  if (!lock) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const { data: latest, error } = await supabase
        .from("marketplace_connection_secrets")
        .select("access_token_ciphertext,expires_at")
        .eq("connection_id", connection.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("Não foi possível verificar a renovação da conexão.");
      if (latest && Date.parse(latest.expires_at) > Date.now() + 60_000) {
        return decryptMarketplaceToken(latest.access_token_ciphertext);
      }
    }
    throw new Error("A renovação do token já está em andamento. Tente novamente em instantes.");
  }

  try {
    const { data: lockedSecret, error: lockedSecretError } = await supabase
      .from("marketplace_connection_secrets")
      .select("access_token_ciphertext,refresh_token_ciphertext,expires_at,token_type,scope")
      .eq("connection_id", connection.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (lockedSecretError || !lockedSecret) throw new Error("Não foi possível ler as credenciais bloqueadas.");
    if (Date.parse(lockedSecret.expires_at) > Date.now() + 60_000) {
      const { error: releaseError } = await supabase
        .from("marketplace_connection_secrets")
        .update({ refresh_lock_until: null })
        .eq("connection_id", connection.id)
        .eq("user_id", userId);
      if (releaseError) throw new Error("Não foi possível liberar o bloqueio de renovação.");
      return decryptMarketplaceToken(lockedSecret.access_token_ciphertext);
    }

    const refreshToken = decryptMarketplaceToken(lockedSecret.refresh_token_ciphertext);
    let renewed: StoredMarketplaceToken;
    if (connection.platform === "mercado_livre") {
      const response = await refreshMercadoLivreToken(refreshToken);
      if (String(response.user_id) !== connection.external_account_id) {
        throw new Error("A renovação retornou uma conta diferente da conexão.");
      }
      renewed = response;
    } else {
      const response = await refreshShopeeToken(refreshToken, connection.external_account_id);
      if (response.shop_id && String(response.shop_id) !== connection.external_account_id) {
        throw new Error("A renovação retornou uma loja diferente da conexão.");
      }
      renewed = {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_in: response.expire_in,
        token_type: "bearer"
      };
    }

    const expiresAt = new Date(Date.now() + renewed.expires_in * 1000).toISOString();
    const { error: saveError } = await supabase
      .from("marketplace_connection_secrets")
      .update({
        access_token_ciphertext: encryptMarketplaceToken(renewed.access_token),
        refresh_token_ciphertext: encryptMarketplaceToken(renewed.refresh_token),
        expires_at: expiresAt,
        token_type: renewed.token_type ?? lockedSecret.token_type,
        scope: renewed.scope ?? lockedSecret.scope,
        refresh_lock_until: null,
        updated_at: new Date().toISOString()
      })
      .eq("connection_id", connection.id)
      .eq("user_id", userId);
    if (saveError) throw new Error("Não foi possível salvar os tokens rotacionados.");

    const { error: metadataError } = await supabase
      .from("marketplace_connections")
      .update({ expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("user_id", userId);
    if (metadataError) throw new Error("Não foi possível atualizar a validade da conexão.");
    return renewed.access_token;
  } catch (caught) {
    const { error: releaseError } = await supabase
      .from("marketplace_connection_secrets")
      .update({ refresh_lock_until: null })
      .eq("connection_id", connection.id)
      .eq("user_id", userId);
    if (releaseError) throw new Error("A renovação falhou e o bloqueio não pôde ser liberado; aguarde até 30 segundos e tente novamente.");
    throw caught instanceof Error ? caught : new Error("Não foi possível renovar a conexão.");
  }
}
