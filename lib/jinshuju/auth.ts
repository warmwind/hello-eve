import { createHash, randomBytes } from "node:crypto";
import {
  consumePendingAuthorization,
  deleteToken,
  readProfile,
  readToken,
  savePendingAuthorization,
  saveProfile,
  saveToken,
  withTokenLock,
  type PendingAuthorization,
  type StoredProfile,
  type StoredToken,
} from "./token-store.js";

const REFRESH_MARGIN_MS = 5 * 60_000;
const AUTHORIZATION_TTL_MS = 10 * 60_000;
const ALLOWED_BILLING_ACCOUNT_NAME = "IM";

function oauthBaseUrl(): string {
  return (process.env.JINSHUJU_OAUTH_BASE_URL ?? "https://account.jinshuju.net").replace(
    /\/+$/,
    "",
  );
}

function apiBaseUrl(): string {
  return (process.env.JINSHUJU_API_BASE_URL ?? "https://jinshuju.net").replace(/\/+$/, "");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function requestedScopes(): string {
  return process.env.JINSHUJU_OAUTH_SCOPES?.trim() || "public users";
}

export function coversRequestedScopes(grantedScope: string | null): boolean {
  if (grantedScope === null) return false;
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return requestedScopes()
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => granted.has(scope));
}

export function discordPrincipalKey(discordUserId: string): string {
  return `discord:${discordUserId}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  created_at?: number;
  scope?: string;
}

interface JinshujuUserResponse {
  id?: unknown;
}

interface JinshujuBillingAccountResponse {
  name?: unknown;
}

export interface JinshujuIdentity {
  userId: string;
  billingAccountName: string;
}

export type DiscordAccessStatus =
  | { status: "authorized"; identity: JinshujuIdentity }
  | { status: "forbidden"; identity: JinshujuIdentity }
  | { status: "authorization_required" };

export interface DiscordAuthorizationDelivery {
  applicationId: string;
  interactionToken: string;
}

export type DiscordAuthorizationOutcome =
  | {
      status: "authorized";
      identity: JinshujuIdentity;
      delivery: DiscordAuthorizationDelivery;
    }
  | {
      status: "forbidden";
      identity: JinshujuIdentity;
      delivery: DiscordAuthorizationDelivery;
    }
  | {
      status: "failed";
      reason: string;
      delivery: DiscordAuthorizationDelivery;
    };

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const clientSecret = process.env.JINSHUJU_CLIENT_SECRET?.trim();
  const body = new URLSearchParams({
    client_id: requiredEnv("JINSHUJU_CLIENT_ID"),
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    ...params,
  });
  const res = await fetch(`${oauthBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jinshuju token endpoint returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

function toStoredToken(response: TokenResponse, fallbackScope: string): StoredToken {
  const issuedAtMs = response.created_at ? response.created_at * 1000 : Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    expiresAtMs: response.expires_in ? issuedAtMs + response.expires_in * 1000 : null,
    scope: response.scope ?? fallbackScope,
  };
}

function isUsable(token: StoredToken): boolean {
  return token.expiresAtMs === null || Date.now() < token.expiresAtMs - REFRESH_MARGIN_MS;
}

async function refreshToken(
  principalKey: string,
  stored: StoredToken,
): Promise<StoredToken | null> {
  const refreshed = await withTokenLock(principalKey, async (current, save) => {
    if (current && isUsable(current)) return current;
    const refreshToken = current?.refreshToken ?? stored.refreshToken;
    if (!refreshToken) return null;
    try {
      const response = await requestToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const next = toStoredToken(response, current?.scope ?? stored.scope ?? "");
      await save(next);
      return next;
    } catch (error) {
      console.error("[jinshuju] token refresh failed:", error);
      return null;
    }
  });
  if (refreshed) return refreshed;
  await deleteToken(principalKey);
  return null;
}

async function fetchJson(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jinshuju API ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

async function fetchIdentity(accessToken: string): Promise<JinshujuIdentity> {
  const [userValue, billingValue] = await Promise.all([
    fetchJson("/api/v1/me", accessToken),
    fetchJson("/api/v1/billing_account", accessToken),
  ]);
  const user = userValue as JinshujuUserResponse;
  const billing = billingValue as JinshujuBillingAccountResponse;
  if (typeof user.id !== "string" || !user.id) {
    throw new Error("Jinshuju /api/v1/me did not return a user id.");
  }
  if (typeof billing.name !== "string" || !billing.name) {
    throw new Error("Jinshuju /api/v1/billing_account did not return a name.");
  }
  return { userId: user.id, billingAccountName: billing.name };
}

function toIdentity(profile: StoredProfile): JinshujuIdentity {
  return {
    userId: profile.userId,
    billingAccountName: profile.billingAccountName,
  };
}

export async function getDiscordAccessStatus(
  discordUserId: string,
): Promise<DiscordAccessStatus> {
  const principalKey = discordPrincipalKey(discordUserId);
  const [profile, token] = await Promise.all([
    readProfile(principalKey),
    readToken(principalKey),
  ]);
  if (
    profile &&
    (!profile.allowed || profile.billingAccountName !== ALLOWED_BILLING_ACCOUNT_NAME)
  ) {
    return { status: "forbidden", identity: toIdentity(profile) };
  }
  if (!profile || !token || !coversRequestedScopes(token.scope)) {
    return { status: "authorization_required" };
  }
  if (!isUsable(token)) {
    const refreshed = await refreshToken(principalKey, token);
    if (!refreshed) return { status: "authorization_required" };
    try {
      const identity = await fetchIdentity(refreshed.accessToken);
      const allowed = identity.billingAccountName === ALLOWED_BILLING_ACCOUNT_NAME;
      await saveProfile(principalKey, { ...identity, allowed });
      if (!allowed) {
        await deleteToken(principalKey);
        return { status: "forbidden", identity };
      }
      return { status: "authorized", identity };
    } catch (error) {
      console.error("[jinshuju] identity refresh failed:", error);
      await deleteToken(principalKey);
      return { status: "authorization_required" };
    }
  }
  return { status: "authorized", identity: toIdentity(profile) };
}

export async function startDiscordAuthorization(input: {
  discordUserId: string;
  discordApplicationId: string;
  discordInteractionToken: string;
}): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  await savePendingAuthorization(state, {
    principalKey: discordPrincipalKey(input.discordUserId),
    verifier,
    discordApplicationId: input.discordApplicationId,
    discordInteractionToken: input.discordInteractionToken,
    expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS),
  });

  const authorizeUrl = new URL(`${oauthBaseUrl()}/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", requiredEnv("JINSHUJU_CLIENT_ID"));
  authorizeUrl.searchParams.set("redirect_uri", requiredEnv("JINSHUJU_REDIRECT_URI"));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", requestedScopes());
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return authorizeUrl.toString();
}

function deliveryFrom(pending: PendingAuthorization): DiscordAuthorizationDelivery {
  return {
    applicationId: pending.discordApplicationId,
    interactionToken: pending.discordInteractionToken,
  };
}

export async function completeDiscordAuthorization(input: {
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<DiscordAuthorizationOutcome> {
  if (!input.state) throw new Error("Missing OAuth state.");
  const pending = await consumePendingAuthorization(input.state);
  if (!pending) throw new Error("OAuth state is invalid, expired, or already used.");
  const delivery = deliveryFrom(pending);
  if (input.error) {
    return { status: "failed", reason: input.error, delivery };
  }
  if (!input.code) {
    return { status: "failed", reason: "missing_code", delivery };
  }

  try {
    const response = await requestToken({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: requiredEnv("JINSHUJU_REDIRECT_URI"),
      code_verifier: pending.verifier,
    });
    const token = toStoredToken(response, requestedScopes());
    const identity = await fetchIdentity(token.accessToken);
    const allowed = identity.billingAccountName === ALLOWED_BILLING_ACCOUNT_NAME;
    if (allowed) {
      await saveToken(pending.principalKey, token);
      await saveProfile(pending.principalKey, { ...identity, allowed });
      return { status: "authorized", identity, delivery };
    }
    await saveProfile(pending.principalKey, { ...identity, allowed });
    await deleteToken(pending.principalKey);
    return { status: "forbidden", identity, delivery };
  } catch (error) {
    console.error("[jinshuju] OAuth completion failed:", error);
    return { status: "failed", reason: "identity_verification_failed", delivery };
  }
}
