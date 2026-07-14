import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Redis } from "@upstash/redis";

export interface PendingAuthorization {
  principalKey: string;
  verifier: string;
  discordApplicationId: string;
  discordInteractionToken: string;
  discordUserId: string;
  discordChannelId: string;
  discordGuildId: string | null;
  message: string | null;
}

const AUTHORIZATION_TTL_SECONDS = 10 * 60;
const CIPHER = "aes-256-gcm";
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_PREFIX = "hello-eve:jinshuju-oauth:";

let redis: Redis | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function getRedis(): Redis {
  if (!redis) {
    const kvUrl = process.env.KV_REST_API_URL?.trim();
    const kvToken = process.env.KV_REST_API_TOKEN?.trim();
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    const credentials =
      kvUrl && kvToken
        ? { url: kvUrl, token: kvToken }
        : upstashUrl && upstashToken
          ? { url: upstashUrl, token: upstashToken }
          : null;
    if (!credentials) {
      throw new Error(
        "No Upstash Redis credentials found (set KV_REST_API_URL and " +
          "KV_REST_API_TOKEN, or the UPSTASH_REDIS_REST_* equivalents).",
      );
    }
    redis = new Redis(credentials);
  }
  return redis;
}

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(requiredEnv("JINSHUJU_CLIENT_SECRET"))
    .update("\0hello-eve:jinshuju-pending-authorization:v1")
    .digest();
}

function seal(value: PendingAuthorization): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function unseal(value: string): PendingAuthorization {
  const [ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (!ivValue || !tagValue || ciphertextValue === undefined || extra !== undefined) {
    throw new Error("Pending Jinshuju authorization is invalid.");
  }
  const decipher = createDecipheriv(
    CIPHER,
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return parsePendingAuthorization(JSON.parse(plaintext) as unknown);
}

function parsePendingAuthorization(value: unknown): PendingAuthorization {
  if (!value || typeof value !== "object") {
    throw new Error("Pending Jinshuju authorization has an invalid payload.");
  }
  const pending = value as Record<string, unknown>;
  const requiredStrings = [
    "principalKey",
    "verifier",
    "discordApplicationId",
    "discordInteractionToken",
    "discordUserId",
    "discordChannelId",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof pending[field] !== "string" || pending[field].length === 0) {
      throw new Error(`Pending Jinshuju authorization has an invalid ${field}.`);
    }
  }
  if (pending.discordGuildId !== null && typeof pending.discordGuildId !== "string") {
    throw new Error("Pending Jinshuju authorization has an invalid discordGuildId.");
  }
  if (pending.message !== null && typeof pending.message !== "string") {
    throw new Error("Pending Jinshuju authorization has an invalid message.");
  }
  return pending as unknown as PendingAuthorization;
}

function redisKey(state: string): string {
  return `${KEY_PREFIX}${state}`;
}

export async function savePendingAuthorization(
  state: string,
  pending: PendingAuthorization,
): Promise<void> {
  if (!STATE_PATTERN.test(state)) throw new Error("OAuth state is invalid.");
  const result = await getRedis().set(redisKey(state), seal(pending), {
    ex: AUTHORIZATION_TTL_SECONDS,
    nx: true,
  });
  if (result !== "OK") throw new Error("OAuth state already exists.");
}

export async function consumePendingAuthorization(
  state: string,
): Promise<PendingAuthorization | null> {
  if (!STATE_PATTERN.test(state)) return null;
  const value = await getRedis().getdel<string>(redisKey(state));
  return value === null ? null : unseal(value);
}
