'use strict';

const { Cid } = require('@tbd54566975/dwn-sdk-js');
function defaultDb() { return require('./milanDb'); }

class PostgresDwnTaskStore {
  constructor({ db = defaultDb(), leaseSeconds = 60 } = {}) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 600) {
      throw new TypeError('Invalid DWN task lease duration.');
    }
    this.db = db;
    this.leaseSeconds = leaseSeconds;
  }

  async open() {
    await this.db.query('SELECT 1');
  }

  // The application owns the shared PostgreSQL pool; this adapter must not close it.
  async close() {}

  async register(task, timeoutInSeconds) {
    const did = String(task?.data?.tenant || '').trim();
    const seconds = Number(timeoutInSeconds);

    if (!did || !task?.name || !Number.isFinite(seconds) ||
        seconds <= 0 || seconds > 600) {
      throw new TypeError('Invalid DWN resumable task.');
    }

    const id = await Cid.computeCid(task);
    const managed = {
      id,
      timeout: Date.now() + seconds * 1000,
      retryCount: 0,
      task
    };

    const metadata = {
      taskName: String(task.name),
      timeout: managed.timeout,
      retryCount: 0
    };

    const result = await this.db.query(
      `INSERT INTO public.dwn_storage
         (component_type, did, space_id, item_key, schema_uri, data_format,
          recipient, published, deleted, metadata, payload, data_size,
          date_created, date_modified, updated_at)
       SELECT 'dwn_task', u.did, u.space_id, $2,
              'milan/dwn-resumable-task', 'application/json',
              u.did, FALSE, FALSE, $3::jsonb, $4::jsonb, 0,
              NOW(), NOW(), NOW()
         FROM public.users u
        WHERE u.did = $1
       ON CONFLICT (did, space_id, component_type, item_key)
       DO UPDATE SET metadata=EXCLUDED.metadata,
                     payload=EXCLUDED.payload,
                     date_modified=NOW(),
                     updated_at=NOW()
       RETURNING item_key`,
      [did, id, JSON.stringify(metadata), JSON.stringify(managed)]
    );

    if (result.rowCount !== 1) {
      throw new Error('DWN task owner is not registered in PostgreSQL.');
    }

    return managed;
  }

  // Atomic multi-instance claim. Expired tasks are leased to one worker only.
  async grab(count) {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
    const now = Date.now();
    const nextTimeout = now + this.leaseSeconds * 1000;

    const result = await this.db.query(
      `WITH candidates AS (
         SELECT id
           FROM public.dwn_storage
          WHERE component_type = 'dwn_task'
            AND deleted = FALSE
            AND COALESCE((payload->>'timeout')::bigint, 0) <= $1
          ORDER BY COALESCE((payload->>'timeout')::bigint, 0), item_key
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ),
       claimed AS (
         UPDATE public.dwn_storage AS s
            SET payload = jsonb_set(
                  jsonb_set(s.payload, '{timeout}', to_jsonb($3::bigint)),
                  '{retryCount}',
                  to_jsonb(COALESCE((s.payload->>'retryCount')::integer, 0) + 1)
                ),
                metadata = jsonb_set(
                  jsonb_set(s.metadata, '{timeout}', to_jsonb($3::bigint)),
                  '{retryCount}',
                  to_jsonb(COALESCE((s.payload->>'retryCount')::integer, 0) + 1)
                ),
                date_modified = NOW(),
                updated_at = NOW()
           FROM candidates c
          WHERE s.id = c.id
          RETURNING s.payload
       )
       SELECT payload FROM claimed`,
      [now, limit, nextTimeout]
    );

    return result.rows.map(row => row.payload);
  }

  async read(taskId) {
    const id = String(taskId || '').trim();
    if (!id) return undefined;

    const result = await this.db.query(
      `SELECT payload
         FROM public.dwn_storage
        WHERE component_type = 'dwn_task'
          AND item_key = $1
          AND deleted = FALSE
        LIMIT 1`,
      [id]
    );

    return result.rows[0]?.payload;
  }

  async extend(taskId, timeoutInSeconds) {
    const id = String(taskId || '').trim();
    const seconds = Number(timeoutInSeconds);

    if (!id || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
      throw new TypeError('Invalid DWN task extension.');
    }

    const timeout = Date.now() + seconds * 1000;

    await this.db.query(
      `UPDATE public.dwn_storage
          SET payload = jsonb_set(payload, '{timeout}', to_jsonb($2::bigint)),
              metadata = jsonb_set(metadata, '{timeout}', to_jsonb($2::bigint)),
              date_modified = NOW(),
              updated_at = NOW()
        WHERE component_type = 'dwn_task'
          AND item_key = $1
          AND deleted = FALSE`,
      [id, timeout]
    );
  }

  async delete(taskId) {
    const id = String(taskId || '').trim();
    if (!id) return false;

    const result = await this.db.query(
      `DELETE FROM public.dwn_storage
        WHERE component_type = 'dwn_task'
          AND item_key = $1`,
      [id]
    );

    return result.rowCount > 0;
  }

  async clear() {
    if (process.env.MILAN_ALLOW_DWN_TASK_CLEAR !== 'true') {
      throw new Error('DWN task-store clearing is disabled in this environment.');
    }

    await this.db.query(
      `DELETE FROM public.dwn_storage WHERE component_type = 'dwn_task'`
    );
  }
}

module.exports = { PostgresDwnTaskStore };
