import { Pool, type PoolClient } from "pg";

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
  scope: string | null;
}

export interface StoredProfile {
  userId: string;
  billingAccountName: string;
  allowed: boolean;
}

export interface PendingAuthorization {
  principalKey: string;
  verifier: string;
  discordApplicationId: string;
  discordInteractionToken: string;
  expiresAt: Date;
}

let pool: Pool | undefined;
let schemaReady: Promise<unknown> | undefined;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS jinshuju_oauth_tokens (
    principal_key text PRIMARY KEY,
    access_token text NOT NULL,
    refresh_token text,
    expires_at_ms bigint,
    scope text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const ADD_SCOPE_COLUMN_SQL = `
  ALTER TABLE jinshuju_oauth_tokens ADD COLUMN IF NOT EXISTS scope text
`;

const CREATE_PROFILES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS jinshuju_oauth_profiles (
    principal_key text PRIMARY KEY,
    user_id text NOT NULL,
    billing_account_name text NOT NULL,
    allowed boolean NOT NULL,
    validated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const CREATE_PENDING_AUTHORIZATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS jinshuju_oauth_pending_authorizations (
    state text PRIMARY KEY,
    principal_key text NOT NULL,
    verifier text NOT NULL,
    discord_application_id text NOT NULL,
    discord_interaction_token text NOT NULL,
    expires_at timestamptz NOT NULL
  )
`;

const UPSERT_SQL = `
  INSERT INTO jinshuju_oauth_tokens (principal_key, access_token, refresh_token, expires_at_ms, scope, updated_at)
  VALUES ($1, $2, $3, $4, $5, now())
  ON CONFLICT (principal_key) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    refresh_token = EXCLUDED.refresh_token,
    expires_at_ms = EXCLUDED.expires_at_ms,
    scope = EXCLUDED.scope,
    updated_at = now()
`;

const SELECT_SQL = `
  SELECT access_token, refresh_token, expires_at_ms, scope
  FROM jinshuju_oauth_tokens
  WHERE principal_key = $1
`;

const UPSERT_PROFILE_SQL = `
  INSERT INTO jinshuju_oauth_profiles (principal_key, user_id, billing_account_name, allowed, validated_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (principal_key) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    billing_account_name = EXCLUDED.billing_account_name,
    allowed = EXCLUDED.allowed,
    validated_at = now()
`;

function getPool(): Pool {
  if (!pool) {
    // Fallback chain covers self-hosting (WORKFLOW_POSTGRES_URL) and the
    // env names Vercel marketplace Postgres (Neon) injects automatically.
    const url =
      process.env.JINSHUJU_TOKEN_POSTGRES_URL ??
      process.env.WORKFLOW_POSTGRES_URL ??
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "No Postgres URL found for the Jinshuju token store (set " +
          "JINSHUJU_TOKEN_POSTGRES_URL, WORKFLOW_POSTGRES_URL, POSTGRES_URL, " +
          "or DATABASE_URL).",
      );
    }
    pool = new Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const postgresPool = getPool();
  schemaReady ??= (async () => {
    await postgresPool.query(CREATE_TABLE_SQL);
    await Promise.all([
      postgresPool.query(ADD_SCOPE_COLUMN_SQL),
      postgresPool.query(CREATE_PROFILES_TABLE_SQL),
      postgresPool.query(CREATE_PENDING_AUTHORIZATIONS_TABLE_SQL),
    ]);
  })();
  await schemaReady;
  const client = await postgresPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function upsertToken(
  client: PoolClient,
  principalKey: string,
  token: StoredToken,
): Promise<void> {
  await client.query(UPSERT_SQL, [
    principalKey,
    token.accessToken,
    token.refreshToken,
    token.expiresAtMs,
    token.scope,
  ]);
}

function rowToToken(row: {
  access_token: string;
  refresh_token: string | null;
  expires_at_ms: string | number | null;
  scope: string | null;
}): StoredToken {
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAtMs: row.expires_at_ms === null ? null : Number(row.expires_at_ms),
    scope: row.scope,
  };
}

export async function readToken(principalKey: string): Promise<StoredToken | null> {
  return withClient(async (client) => {
    const res = await client.query(SELECT_SQL, [principalKey]);
    return res.rows[0] ? rowToToken(res.rows[0]) : null;
  });
}

export async function saveToken(principalKey: string, token: StoredToken): Promise<void> {
  await withClient(async (client) => {
    await upsertToken(client, principalKey, token);
  });
}

export async function deleteToken(principalKey: string): Promise<void> {
  await withClient(async (client) => {
    await client.query("DELETE FROM jinshuju_oauth_tokens WHERE principal_key = $1", [
      principalKey,
    ]);
  });
}

export async function readProfile(principalKey: string): Promise<StoredProfile | null> {
  return withClient(async (client) => {
    const res = await client.query(
      `SELECT user_id, billing_account_name, allowed
       FROM jinshuju_oauth_profiles
       WHERE principal_key = $1`,
      [principalKey],
    );
    const row = res.rows[0] as
      | { user_id: string; billing_account_name: string; allowed: boolean }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          billingAccountName: row.billing_account_name,
          allowed: row.allowed,
        }
      : null;
  });
}

export async function saveProfile(
  principalKey: string,
  profile: StoredProfile,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(UPSERT_PROFILE_SQL, [
      principalKey,
      profile.userId,
      profile.billingAccountName,
      profile.allowed,
    ]);
  });
}

export async function savePendingAuthorization(
  state: string,
  pending: PendingAuthorization,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `DELETE FROM jinshuju_oauth_pending_authorizations WHERE expires_at <= now()`,
    );
    await client.query(
      `INSERT INTO jinshuju_oauth_pending_authorizations
         (state, principal_key, verifier, discord_application_id, discord_interaction_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        state,
        pending.principalKey,
        pending.verifier,
        pending.discordApplicationId,
        pending.discordInteractionToken,
        pending.expiresAt,
      ],
    );
  });
}

export async function consumePendingAuthorization(
  state: string,
): Promise<PendingAuthorization | null> {
  return withClient(async (client) => {
    const res = await client.query(
      `DELETE FROM jinshuju_oauth_pending_authorizations
       WHERE state = $1
       RETURNING principal_key, verifier, discord_application_id,
                 discord_interaction_token, expires_at`,
      [state],
    );
    const row = res.rows[0] as
      | {
          principal_key: string;
          verifier: string;
          discord_application_id: string;
          discord_interaction_token: string;
          expires_at: Date | string;
        }
      | undefined;
    if (!row) return null;
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() <= Date.now()) return null;
    return {
      principalKey: row.principal_key,
      verifier: row.verifier,
      discordApplicationId: row.discord_application_id,
      discordInteractionToken: row.discord_interaction_token,
      expiresAt,
    };
  });
}

/**
 * Runs `fn` holding a per-principal advisory lock, re-reading the stored
 * token after the lock is acquired. Doorkeeper rotates refresh tokens on
 * use, so two concurrent refreshes would revoke the copy the loser is
 * about to send; `fn` must re-check `current` before deciding to refresh.
 */
export async function withTokenLock<T>(
  principalKey: string,
  fn: (
    current: StoredToken | null,
    save: (token: StoredToken) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `jinshuju:${principalKey}`,
      ]);
      const res = await client.query(SELECT_SQL, [principalKey]);
      const current = res.rows[0] ? rowToToken(res.rows[0]) : null;
      const save = async (token: StoredToken) => {
        await upsertToken(client, principalKey, token);
      };
      const result = await fn(current, save);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
