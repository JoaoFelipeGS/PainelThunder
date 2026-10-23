import { NextResponse, type NextRequest } from "next/server";
import { requireMarketplaceConfig } from "@/lib/marketplaces/shared/config";
import {
  createCodeChallenge,
  createCodeVerifier,
  createOAuthStateCookie,
  createRandomState,
  type MarketplacePlatform,
  type OAuthState
} from "@/lib/marketplaces/shared/security";
import { createShopeeAuthorizationUrl } from "@/lib/marketplaces/shopee/client";
import { createServerSupabase } from "@/lib/supabase/server";

const stateCookieName = "marketplace_oauth_state";

function parsePlatform(value: string): MarketplacePlatform | null {
  if (value === "mercado-livre") return "mercado_livre";
  if (value === "shopee") return "shopee";
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform: routePlatform } = await context.params;
  const platform = parsePlatform(routePlatform);
  if (!platform) return NextResponse.json({ error: "Integração desconhecida." }, { status: 404 });

  try {
    const config = requireMarketplaceConfig(platform);
    const supabase = await createServerSupabase();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.redirect(new URL("/login", request.url));

    const state = createRandomState();
    const codeVerifier = platform === "mercado_livre" && process.env.MERCADO_LIVRE_PKCE_ENABLED === "true"
      ? createCodeVerifier()
      : undefined;
    const payload: OAuthState = {
      platform,
      state,
      userId: user.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
      ...(codeVerifier ? { codeVerifier } : {})
    };
    const cookieValue = createOAuthStateCookie(payload);
    let authorizationUrl: URL;

    if (platform === "mercado_livre") {
      const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
      if (!clientId) throw new Error("Credenciais do Mercado Livre não configuradas.");
      authorizationUrl = new URL("https://auth.mercadolivre.com.br/authorization");
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", clientId);
      authorizationUrl.searchParams.set("redirect_uri", config.callbackUrl);
      authorizationUrl.searchParams.set("state", state);
      if (codeVerifier) {
        authorizationUrl.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
        authorizationUrl.searchParams.set("code_challenge_method", "S256");
      }
    } else {
      authorizationUrl = new URL(createShopeeAuthorizationUrl(config.callbackUrl, state));
    }

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(stateCookieName, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    const result = new URL("/app/configuracoes", request.url);
    result.searchParams.set("integration", routePlatform);
    result.searchParams.set("result", "not-configured");
    return NextResponse.redirect(result);
  }
}
