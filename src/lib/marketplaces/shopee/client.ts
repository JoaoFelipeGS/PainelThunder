import "server-only";
import { signShopeeRequest } from "@/lib/marketplaces/shared/security";

const apiHost = "https://openplatform.shopee.com.br";
const tokenPath = "/api/v2/auth/token/get";
const refreshPath = "/api/v2/auth/access_token/get";
const shopInfoPath = "/api/v2/shop/get_shop_info";
const updateStockPath = "/api/v2/product/update_stock";

type ShopeeTokenResponse = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id?: number | string;
  merchant_id?: number | string;
};

function credentials() {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !/^\d+$/.test(partnerId) || !partnerKey) {
    throw new Error("Credenciais da Shopee não configuradas.");
  }
  return { partnerId, partnerKey };
}

function accountId(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) return null;
  return String(value);
}

function parseTokenResponse(value: unknown): ShopeeTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta inválida da Shopee.");
  const data = value as Record<string, unknown>;
  if (typeof data.error === "string" && data.error) throw new Error("A Shopee recusou a autenticação.");
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error("A Shopee não retornou as credenciais esperadas.");
  }
  const expiry = Number(data.expire_in);
  if (!Number.isFinite(expiry) || expiry <= 0) throw new Error("A Shopee retornou uma validade inválida.");
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = expiry > 31_536_000 ? expiry - now : expiry;
  if (expiresIn <= 0 || expiresIn > 31_536_000) throw new Error("A Shopee retornou uma validade inválida.");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expire_in: expiresIn,
    shop_id: data.shop_id as number | string | undefined,
    merchant_id: data.merchant_id as number | string | undefined
  };
}

function signedParameters(path: string, accessToken?: string, shopId?: string) {
  const { partnerId, partnerKey } = credentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const baseString = accessToken && shopId
    ? `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${path}${timestamp}`;
  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp,
    sign: signShopeeRequest(partnerKey, baseString)
  });
  if (accessToken) params.set("access_token", accessToken);
  if (shopId) params.set("shop_id", shopId);
  return params;
}

export function createShopeeAuthorizationUrl(redirectUri: string, state: string) {
  const { partnerId, partnerKey } = credentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = "/api/v2/shop/auth_partner";
  const sign = signShopeeRequest(partnerKey, `${partnerId}${path}${timestamp}`);
  const url = new URL(`${apiHost}${path}`);
  url.search = new URLSearchParams({
    partner_id: partnerId,
    timestamp,
    sign,
    redirect: redirectUri,
    state
  }).toString();
  return url.toString();
}

async function postSigned(path: string, body: Record<string, string>) {
  const response = await fetch(`${apiHost}${path}?${signedParameters(path)}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`A Shopee recusou a solicitação de autorização (HTTP ${response.status}).`);
  return response.json() as Promise<unknown>;
}

export async function exchangeShopeeCode(code: string, shopId: string) {
  const { partnerId } = credentials();
  const response = await postSigned(tokenPath, { code, partner_id: partnerId, shop_id: shopId });
  const token = parseTokenResponse(response);
  return { ...token, shop_id: accountId(token.shop_id) ?? shopId };
}

export async function refreshShopeeToken(refreshToken: string, shopId: string) {
  const { partnerId } = credentials();
  const response = await postSigned(refreshPath, {
    refresh_token: refreshToken,
    partner_id: partnerId,
    shop_id: shopId
  });
  return parseTokenResponse(response);
}

export async function getShopeeShopName(accessToken: string, shopId: string) {
  const params = signedParameters(shopInfoPath, accessToken, shopId);
  const response = await fetch(`${apiHost}${shopInfoPath}?${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Não foi possível confirmar a loja Shopee (HTTP ${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta inválida da Shopee.");
  const data = value as Record<string, unknown>;
  if (typeof data.error === "string" && data.error) throw new Error("Não foi possível confirmar a loja Shopee.");
  return typeof data.shop_name === "string" ? data.shop_name : `Loja ${shopId}`;
}

export async function updateShopeeStock(
  accessToken: string,
  shopId: string,
  itemId: string,
  modelId: string | null,
  quantity: number
) {
  if (!/^\d+$/.test(shopId) || !/^\d+$/.test(itemId) || (modelId !== null && !/^\d+$/.test(modelId))) {
    throw new Error("Identificador de anúncio Shopee inválido.");
  }
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Quantidade de estoque inválida.");

  const params = signedParameters(updateStockPath, accessToken, shopId);
  const response = await fetch(`${apiHost}${updateStockPath}?${params}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      item_id: Number(itemId),
      stock_list: [{
        model_id: modelId ? Number(modelId) : 0,
        seller_stock: [{ location_id: "-", stock: quantity }]
      }]
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`A Shopee recusou a atualização do estoque (HTTP ${response.status}).`);

  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta inválida da Shopee.");
  const result = value as Record<string, unknown>;
  if (typeof result.error === "string" && result.error) throw new Error("A Shopee retornou erro ao atualizar o estoque.");
}
