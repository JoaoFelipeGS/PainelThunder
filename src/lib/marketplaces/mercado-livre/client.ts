import "server-only";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number | string;
  scope?: string;
  token_type?: string;
};

type AuthorizedUser = {
  id: number | string;
  nickname?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta inválida do Mercado Livre.");
  return value as Record<string, unknown>;
}

async function postToken(form: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) throw new Error(`O Mercado Livre recusou a autenticação (HTTP ${response.status}).`);
  const data = asRecord(await response.json());
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error("O Mercado Livre não retornou as credenciais esperadas.");
  }
  const expiresIn = Number(data.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("O Mercado Livre retornou uma validade inválida.");
  const userId = data.user_id;
  if ((typeof userId !== "string" && typeof userId !== "number") || !/^\d+$/.test(String(userId))) {
    throw new Error("O Mercado Livre retornou um identificador de conta inválido.");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: expiresIn,
    user_id: userId,
    scope: typeof data.scope === "string" ? data.scope : undefined,
    token_type: typeof data.token_type === "string" ? data.token_type : undefined
  };
}

export async function exchangeMercadoLivreCode(code: string, redirectUri: string, codeVerifier?: string) {
  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais do Mercado Livre não configuradas.");

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });
  if (codeVerifier) form.set("code_verifier", codeVerifier);
  return postToken(form);
}

export async function refreshMercadoLivreToken(refreshToken: string) {
  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais do Mercado Livre não configuradas.");

  return postToken(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  }));
}

export async function getMercadoLivreAccount(accessToken: string): Promise<AuthorizedUser> {
  const response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Não foi possível confirmar a conta do Mercado Livre (HTTP ${response.status}).`);

  const data = asRecord(await response.json());
  if ((typeof data.id !== "number" && typeof data.id !== "string") || !/^\d+$/.test(String(data.id))) {
    throw new Error("O Mercado Livre retornou um identificador de conta inválido.");
  }
  return { id: data.id, nickname: typeof data.nickname === "string" ? data.nickname : undefined };
}

export async function updateMercadoLivreStock(
  accessToken: string,
  itemId: string,
  variationId: string | null,
  quantity: number
) {
  if (!/^\d+$/.test(itemId) || (variationId !== null && !/^\d+$/.test(variationId))) {
    throw new Error("Identificador de anúncio inválido.");
  }
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Quantidade de estoque inválida.");

  const body = variationId
    ? { variations: [{ id: Number(variationId), available_quantity: quantity }] }
    : { available_quantity: quantity };
  const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`O Mercado Livre recusou a atualização do estoque (HTTP ${response.status}).`);

  const result = asRecord(await response.json());
  if (typeof result.error === "string" && result.error) {
    throw new Error("O Mercado Livre retornou erro ao atualizar o estoque.");
  }
}
