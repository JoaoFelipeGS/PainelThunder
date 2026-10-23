import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeMercadoLivreCode, getMercadoLivreAccount } from "@/lib/marketplaces/mercado-livre/client";
import { storeMarketplaceConnection } from "@/lib/marketplaces/shared/connections";
import { getMarketplaceCallbackUrl } from "@/lib/marketplaces/shared/config";
import { verifyOAuthStateCookie, type MarketplacePlatform } from "@/lib/marketplaces/shared/security";
import { exchangeShopeeCode, getShopeeShopName } from "@/lib/marketplaces/shopee/client";
import { createServerSupabase } from "@/lib/supabase/server";

const stateCookieName = "marketplace_oauth_state";

function parsePlatform(value: string): MarketplacePlatform | null {
  if (value === "mercado-livre") return "mercado_livre";
  if (value === "shopee") return "shopee";
  return null;
}

function resultUrl(request: NextRequest, routePlatform: string, result: string) {
  const url = new URL("/app/configuracoes", request.url);
  url.searchParams.set("integration", routePlatform);
  url.searchParams.set("result", result);
  return url;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform: routePlatform } = await context.params;
  const platform = parsePlatform(routePlatform);
  if (!platform) return NextResponse.json({ error: "Integração desconhecida." }, { status: 404 });

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(stateCookieName)?.value;
  const query = request.nextUrl.searchParams;
  const state = query.get("state") ?? "";
  const authorizationError = query.has("error");
  let result = "error";

  try {
    if (!cookieValue || !state) throw new Error("Callback OAuth sem estado válido.");
    const payload = verifyOAuthStateCookie(cookieValue, state, platform);
    if (!payload) throw new Error("Callback OAuth com estado inválido ou expirado.");

    const supabase = await createServerSupabase();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || user.id !== payload.userId) throw new Error("A sessão autenticada não corresponde à solicitação de conexão.");
    if (authorizationError) throw new Error("A autorização foi recusada.");

    const code = query.get("code");
    if (!code || code.length > 4096) throw new Error("Código de autorização ausente ou inválido.");

    if (platform === "mercado_livre") {
      const redirectUri = getMarketplaceCallbackUrl(platform);
      const token = await exchangeMercadoLivreCode(code, redirectUri, payload.codeVerifier);
      const account = await getMercadoLivreAccount(token.access_token);
      if (String(account.id) !== String(token.user_id)) throw new Error("A conta retornada pelo token não confere.");
      await storeMarketplaceConnection({
        userId: user.id,
        platform,
        accountId: String(account.id),
        accountLabel: account.nickname || `Conta ${account.id}`,
        token
      });
    } else {
      const shopId = query.get("shop_id");
      if (!shopId || !/^\d+$/.test(shopId)) throw new Error("A Shopee não retornou um ID de loja válido.");
      const token = await exchangeShopeeCode(code, shopId);
      const resolvedShopId = token.shop_id ?? shopId;
      const accountLabel = await getShopeeShopName(token.access_token, resolvedShopId);
      await storeMarketplaceConnection({
        userId: user.id,
        platform,
        accountId: resolvedShopId,
        accountLabel,
        token: {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_in: token.expire_in,
          token_type: "bearer"
        }
      });
    }
    result = "connected";
  } catch {
    result = authorizationError ? "cancelled" : "error";
  }

  const response = NextResponse.redirect(resultUrl(request, routePlatform, result));
  response.cookies.set(stateCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
