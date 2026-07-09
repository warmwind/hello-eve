import { Pool } from "pg";

// Reuses the same Postgres the workflow world runs on (agent/agent.ts).
const connectionString =
  process.env.WORKFLOW_POSTGRES_URL ?? process.env.SCHEDULE_POSTGRES_URL;

let poolPromise: Promise<Pool> | null = null;

async function getPool(): Promise<Pool> {
  if (!connectionString) {
    throw new Error(
      "Set WORKFLOW_POSTGRES_URL (or SCHEDULE_POSTGRES_URL) to a reachable Postgres for dynamic schedules.",
    );
  }
  poolPromise ??= (async () => {
    const pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dynamic_schedules (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id      text        NOT NULL,
        channel_id    text        NOT NULL,
        prompt        text        NOT NULL,
        every_minutes integer,
        next_run_at   timestamptz NOT NULL,
        enabled       boolean     NOT NULL DEFAULT true,
        lease_until   timestamptz,
        last_error    text,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS dynamic_schedules_due_idx
        ON dynamic_schedules (next_run_at)
        WHERE enabled;
    `);
    return pool;
  })();
  return poolPromise;
}

export interface ScheduleOwner {
  ownerId: string;
}

export interface CreateInput {
  prompt: string;
  channelId: string;
  firstRunAt: Date;
  everyMinutes: number | null;
}

export interface ScheduleRow {
  id: string;
  ownerId: string;
  channelId: string;
  prompt: string;
  everyMinutes: number | null;
  nextRunAt: string;
  enabled: boolean;
  lastError: string | null;
}

export interface ClaimedSchedule {
  id: string;
  ownerId: string;
  channelId: string;
  prompt: string;
  everyMinutes: number | null;
}

function toRow(r: Record<string, unknown>): ScheduleRow {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    channelId: r.channel_id as string,
    prompt: r.prompt as string,
    everyMinutes: (r.every_minutes as number | null) ?? null,
    nextRunAt: (r.next_run_at as Date).toISOString(),
    enabled: r.enabled as boolean,
    lastError: (r.last_error as string | null) ?? null,
  };
}

export const scheduleStore = {
  async create(owner: ScheduleOwner, input: CreateInput): Promise<ScheduleRow> {
    const pool = await getPool();
    const { rows } = await pool.query(
      `INSERT INTO dynamic_schedules
         (owner_id, channel_id, prompt, every_minutes, next_run_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [owner.ownerId, input.channelId, input.prompt, input.everyMinutes, input.firstRunAt],
    );
    return toRow(rows[0]);
  },

  async list(owner: ScheduleOwner): Promise<ScheduleRow[]> {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT * FROM dynamic_schedules
        WHERE owner_id = $1 AND enabled
        ORDER BY next_run_at ASC`,
      [owner.ownerId],
    );
    return rows.map(toRow);
  },

  async delete(owner: ScheduleOwner, id: string): Promise<boolean> {
    const pool = await getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM dynamic_schedules WHERE id = $1 AND owner_id = $2`,
      [id, owner.ownerId],
    );
    return (rowCount ?? 0) > 0;
  },

  // Atomically leases due rows so overlapping minute ticks never claim the
  // same work: SKIP LOCKED skips rows another tick is already holding.
  async claimDue(options: { now: Date; limit: number; leaseForMs: number }): Promise<ClaimedSchedule[]> {
    const pool = await getPool();
    const leaseUntil = new Date(options.now.getTime() + options.leaseForMs);
    const { rows } = await pool.query(
      `UPDATE dynamic_schedules SET lease_until = $2
        WHERE id IN (
          SELECT id FROM dynamic_schedules
           WHERE enabled
             AND next_run_at <= $1
             AND (lease_until IS NULL OR lease_until < $1)
           ORDER BY next_run_at ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, owner_id, channel_id, prompt, every_minutes`,
      [options.now, leaseUntil, options.limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      ownerId: r.owner_id as string,
      channelId: r.channel_id as string,
      prompt: r.prompt as string,
      everyMinutes: (r.every_minutes as number | null) ?? null,
    }));
  },

  // One-time rows are disabled; recurring rows advance to the next tick.
  async complete(job: ClaimedSchedule): Promise<void> {
    const pool = await getPool();
    if (job.everyMinutes == null) {
      await pool.query(
        `UPDATE dynamic_schedules
            SET enabled = false, lease_until = NULL, last_error = NULL
          WHERE id = $1`,
        [job.id],
      );
      return;
    }
    await pool.query(
      `UPDATE dynamic_schedules
          SET next_run_at = now() + make_interval(mins => $2),
              lease_until = NULL,
              last_error = NULL
        WHERE id = $1`,
      [job.id, job.everyMinutes],
    );
  },

  async release(job: ClaimedSchedule, failure: { error: unknown; retryAt: Date }): Promise<void> {
    const pool = await getPool();
    await pool.query(
      `UPDATE dynamic_schedules
          SET next_run_at = $2, lease_until = NULL, last_error = $3
        WHERE id = $1`,
      [job.id, failure.retryAt, String((failure.error as Error)?.message ?? failure.error)],
    );
  },
};
