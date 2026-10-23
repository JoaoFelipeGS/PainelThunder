import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type MarketplacePlatform = "mercado_livre" | "shopee";

export type OAuthState = {
  platform: MarketplacePlatform;
  state: string;
  userId: string;
  expiresAt: number;
  codeVerifier?: string;
};

function getStateSecret() {
  const secret = process.env.MARKETPLACE_OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("MARKETPLACE_OAUTH_STATE_SECRET precisa ter pelo menos 32 bytes.");
  }
  return secret;
}

function getEncryptionKey() {
  const value = process.env.MARKETPLACE_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("MARKETPLACE_TOKEN_ENCRYPTION_KEY não configurada.");

  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    throw new Error("MARKETPLACE_TOKEN_ENCRYPTION_KEY precisa ser Base64 válido.");
  }
  if (key.length !== 32) throw new Error("MARKETPLACE_TOKEN_ENCRYPTION_KEY precisa representar exatamente 32 bytes.");
  return key;
}

function signature(value: string) {
  return createHmac("sha256", getStateSecret()).update(value).digest();
}

export function createOAuthStateCookie(payload: OAuthState) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

export function verifyOAuthStateCookie(cookieValue: string, expectedState: string, platform: MarketplacePlatform): OAuthState | null {
  const [encoded, suppliedSignature, extra] = cookieValue.split(".");
  if (!encoded || !suppliedSignature || extra) return null;

  const expectedSignature = signature(encoded);
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (signatureBytes.length !== expectedSignature.length || !timingSafeEqual(signatureBytes, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    if (payload.platform !== platform || payload.state !== expectedState || payload.expiresAt <= Date.now()) return null;
    if (!/^[0-9a-f-]{36}$/i.test(payload.userId)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function signShopeeRequest(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function encryptMarketplaceToken(token: string) {
  if (!token) throw new Error("Não é possível cifrar um token vazio.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptMarketplaceToken(envelope: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("Formato de credencial cifrada inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function createRandomState() {
  return randomBytes(32).toString("base64url");
}
