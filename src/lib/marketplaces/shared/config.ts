import "server-only";
import type { MarketplacePlatform } from "./security";

export type MarketplaceConfig = {
  platform: MarketplacePlatform;
  callbackUrl: string;
};

export function getMarketplaceCallbackUrl(platform: MarketplacePlatform) {
  const configured = platform === "mercado_livre"
    ? process.env.MERCADO_LIVRE_REDIRECT_URI
    : process.env.SHOPEE_REDIRECT_URI;
  if (!configured) throw new Error("URL de callback não configurada.");

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("URL de callback inválida.");
  }
  const expectedPath = platform === "mercado_livre"
    ? "/api/marketplaces/mercado-livre/callback"
    : "/api/marketplaces/shopee/callback";
  const allowedProtocol = url.protocol === "https:" || (
    process.env.NODE_ENV !== "production"
    && url.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
  );
  if (!allowedProtocol || url.pathname !== expectedPath || url.username || url.password || url.search || url.hash) {
    throw new Error(`A URL de callback deve ser HTTPS e terminar em ${expectedPath}.`);
  }
  return url.toString();
}

export function isMarketplaceConfigured(platform: MarketplacePlatform) {
  try {
    getMarketplaceCallbackUrl(platform);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.MARKETPLACE_TOKEN_ENCRYPTION_KEY || !process.env.MARKETPLACE_OAUTH_STATE_SECRET) return false;
    if (platform === "mercado_livre") {
      return Boolean(process.env.MERCADO_LIVRE_CLIENT_ID && process.env.MERCADO_LIVRE_CLIENT_SECRET);
    }
    return Boolean(
      process.env.SHOPEE_PARTNER_ID
      && /^\d+$/.test(process.env.SHOPEE_PARTNER_ID)
      && process.env.SHOPEE_PARTNER_KEY
    );
  } catch {
    return false;
  }
}

export function requireMarketplaceConfig(platform: MarketplacePlatform): MarketplaceConfig {
  if (!isMarketplaceConfigured(platform)) {
    throw new Error("A integração não está configurada no servidor.");
  }
  return { platform, callbackUrl: getMarketplaceCallbackUrl(platform) };
}
