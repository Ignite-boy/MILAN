'use strict';

const { Readable } = require('readable-stream');
const { Message, SortDirection } = require('@tbd54566975/dwn-sdk-js');
const { monotonicFactory } = require('ulidx');
function defaultDb() { return require('./milanDb'); }

const TYPES = {
  message: 'dwn_message',
  data: 'dwn_data',
  event: 'dwn_event'
};

function checkAbort(options) {
  if (options?.signal?.aborted) {
    throw options.signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
  }
}

function validDid(value) {
  const did = String(value || '').trim();
  if (!did.startsWith('did:')) throw new TypeError('Valid tenant DID required.');
  return did;
}

async function scope(db, tenant) {
  const did = validDid(tenant);
  const r = await db.query(
    'SELECT space_id FROM public.users WHERE did=$1 AND space_id IS NOT NULL LIMIT 1',
    [did]
  );
  if (r.rowCount !== 1) throw new Error('DWN tenant is not registered in PostgreSQL.');
  return { did, spaceId: r.rows[0].space_id };
}

async function clearType(db, type) {
  if (process.env.MILAN_ALLOW_DWN_STORE_CLEAR !== 'true') {
    throw new Error('DWN store clearing is disabled outside isolated tests.');
  }
  await db.query('DELETE FROM public.dwn_storage WHERE component_type=$1', [type]);
}

function encodeNumber(value) {
  const offset = Number.MAX_SAFE_INTEGER;
  return (value < 0 ? '!' : '') +
    String(value + (value < 0 ? offset : 0)).padStart(String(offset).length, '0');
}

function encode(value) {
  return typeof value === 'number' ? encodeNumber(value) : JSON.stringify(value);
}

function key(value, cid) {
  return `${encode(value)}\u0000${cid}`;
}

function matchesValue(filter, value) {
  if (Array.isArray(filter)) return filter.some(v => v === value);
  if (filter !== null && typeof filter === 'object') {
    if (filter.lt !== undefined && value >= filter.lt) return false;
    if (filter.lte !== undefined && value > filter.lte) return false;
    if (filter.gt !== undefined && value <= filter.gt) return false;
    if (filter.gte !== undefined && value < filter.gte) return false;
    return true;
  }
  return filter === value;
}

function matchesFilter(indexes, filter) {
  if (!filter || typeof filter !== 'object') return false;
  return Object.keys(filter).every(name => {
    const value = indexes?.[name];
    if (value === undefined) return false;
    return Array.isArray(value)
      ? value.some(v => matchesValue(filter[name], v))
      : matchesValue(filter[name], value);
  });
}

function matchesAny(indexes, filters) {
  return !Array.isArray(filters) || filters.length === 0 ||
    filters.some(filter => matchesFilter(indexes, filter));
}

function sortInfo(sort = {}) {
  const property = sort.dateCreated !== undefined ? 'dateCreated'
    : sort.datePublished !== undefined ? 'datePublished'
      : 'messageTimestamp';
  return { property, descending: sort[property] === SortDirection.Descending };
}

function cursorFor(item, property) {
  const value = item.indexes[property];
  if (value === undefined || typeof value === 'boolean' || Array.isArray(value)) {
    throw new TypeError('Invalid DWN pagination sort value.');
  }
  return { messageCid: item.messageCid, value };
}

class PostgresMessageStore {
  constructor({ db = defaultDb() } = {}) { this.db = db; }
  async open() { await this.db.query('SELECT 1'); }
  async close() {}

  async put(tenant, message, indexes, options) {
    checkAbort(options);
    if (!indexes || !Object.keys(indexes).length) {
      throw new TypeError('DWN message indexes cannot be empty.');
    }
    const { did } = await scope(this.db, tenant);
    const cid = await Message.getCid(message);
    const r = await this.db.query(
      `INSERT INTO public.dwn_storage
       (component_type,did,space_id,item_key,schema_uri,data_format,
        recipient,published,deleted,metadata,payload,data_size,
        date_created,date_modified,updated_at)
       SELECT $3,u.did,u.space_id,$2,'milan/dwn-message','application/json',
              u.did,FALSE,FALSE,$4::jsonb,$5::jsonb,0,NOW(),NOW(),NOW()
       FROM public.users u WHERE u.did=$1 AND u.space_id IS NOT NULL
       ON CONFLICT (did,space_id,component_type,item_key)
       DO UPDATE SET metadata=EXCLUDED.metadata,payload=EXCLUDED.payload,
                     date_modified=NOW(),updated_at=NOW()
       RETURNING id`,
      [did, cid, TYPES.message, JSON.stringify({ indexes }), JSON.stringify(message)]
    );
    if (r.rowCount !== 1) throw new Error('DWN message tenant mapping changed during storage.');
  }

  async get(tenant, cid, options) {
    checkAbort(options);
    const { did, spaceId } = await scope(this.db, tenant);
    const r = await this.db.query(
      `SELECT payload FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3
         AND item_key=$4 AND deleted=FALSE LIMIT 1`,
      [did, spaceId, TYPES.message, String(cid)]
    );
    return r.rows[0]?.payload;
  }

  async query(tenant, filters, messageSort = {}, pagination = {}, options) {
    checkAbort(options);
    const { did, spaceId } = await scope(this.db, tenant);
    const { property, descending } = sortInfo(messageSort);
    const r = await this.db.query(
      `SELECT item_key,metadata,payload FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3
         AND deleted=FALSE AND payload IS NOT NULL`,
      [did, spaceId, TYPES.message]
    );

    let items = r.rows.map(row => ({
      messageCid: row.item_key,
      indexes: row.metadata?.indexes || {},
      message: row.payload
    })).filter(item =>
      item.indexes[property] !== undefined && matchesAny(item.indexes, filters)
    );

    items.sort((a, b) => {
      const result = key(a.indexes[property], a.messageCid)
        .localeCompare(key(b.indexes[property], b.messageCid));
      return descending ? -result : result;
    });

    if (pagination?.cursor) {
      const c = pagination.cursor;
      if (typeof c.messageCid !== 'string' ||
          (typeof c.value !== 'string' && typeof c.value !== 'number')) {
        throw new TypeError('Invalid DWN pagination cursor.');
      }
      const start = key(c.value, c.messageCid);
      items = items.filter(item => {
        const comparison = key(item.indexes[property], item.messageCid).localeCompare(start);
        return descending ? comparison < 0 : comparison > 0;
      });
    }

    const limit = Number(pagination?.limit);
    let cursor;
    if (Number.isFinite(limit) && limit > 0 && items.length > limit) {
      items = items.slice(0, Math.floor(limit));
      cursor = cursorFor(items[items.length - 1], property);
    }
    return { messages: items.map(item => item.message), cursor };
  }

  async delete(tenant, cid, options) {
    checkAbort(options);
    const { did, spaceId } = await scope(this.db, tenant);
    await this.db.query(
      `DELETE FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3 AND item_key=$4`,
      [did, spaceId, TYPES.message, String(cid)]
    );
  }

  async clear() { await clearType(this.db, TYPES.message); }
}

class PostgresDataStore {
  constructor({
    db = defaultDb(),
    maxDataBytes = Number(process.env.MILAN_DWN_MAX_DATA_BYTES || 256 * 1024 * 1024)
  } = {}) {
    if (!Number.isSafeInteger(maxDataBytes) || maxDataBytes < 1) {
      throw new TypeError('Invalid DWN data size limit.');
    }
    this.db = db;
    this.maxDataBytes = maxDataBytes;
  }

  async open() { await this.db.query('SELECT 1'); }
  async close() {}

  itemKey(recordId, dataCid) {
    return JSON.stringify([String(recordId), String(dataCid)]);
  }

  async put(tenant, recordId, dataCid, stream) {
    const { did } = await scope(this.db, tenant);
    const chunks = [];
    let size = 0;

    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > this.maxDataBytes) {
          throw new RangeError('DWN data exceeds MILAN_DWN_MAX_DATA_BYTES.');
        }
        chunks.push(bytes);
      }
    } catch (error) {
      stream.destroy?.(error);
      throw error;
    }

    const data = Buffer.concat(chunks, size);
    const item = this.itemKey(recordId, dataCid);
    const r = await this.db.query(
      `INSERT INTO public.dwn_storage
       (component_type,did,space_id,item_key,parent_key,schema_uri,
        data_format,recipient,published,deleted,metadata,data_bytes,
        data_cid,data_size,date_created,date_modified,updated_at)
       SELECT $3,u.did,u.space_id,$2,$4,'milan/dwn-data',
              'application/octet-stream',u.did,FALSE,FALSE,'{}'::jsonb,
              $5,$6,$7,NOW(),NOW(),NOW()
       FROM public.users u WHERE u.did=$1 AND u.space_id IS NOT NULL
       ON CONFLICT (did,space_id,component_type,item_key)
       DO UPDATE SET data_bytes=EXCLUDED.data_bytes,data_cid=EXCLUDED.data_cid,
                     data_size=EXCLUDED.data_size,parent_key=EXCLUDED.parent_key,
                     date_modified=NOW(),updated_at=NOW()
       RETURNING id`,
      [did, item, TYPES.data, String(recordId), data, String(dataCid), size]
    );
    if (r.rowCount !== 1) throw new Error('DWN data tenant mapping changed during storage.');
    return { dataSize: size };
  }

  async get(tenant, recordId, dataCid) {
    const { did, spaceId } = await scope(this.db, tenant);
    const r = await this.db.query(
      `SELECT data_bytes,data_size FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3
         AND item_key=$4 AND deleted=FALSE LIMIT 1`,
      [did, spaceId, TYPES.data, this.itemKey(recordId, dataCid)]
    );
    const row = r.rows[0];
    if (!row || row.data_bytes === null) return undefined;
    const bytes = Buffer.from(row.data_bytes);
    return { dataSize: Number(row.data_size), dataStream: Readable.from([bytes]) };
  }

  async delete(tenant, recordId, dataCid) {
    const { did, spaceId } = await scope(this.db, tenant);
    await this.db.query(
      `DELETE FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3 AND item_key=$4`,
      [did, spaceId, TYPES.data, this.itemKey(recordId, dataCid)]
    );
  }

  async clear() { await clearType(this.db, TYPES.data); }
}

class PostgresEventLog {
  constructor({ db = defaultDb(), ulidFactory = monotonicFactory() } = {}) {
    this.db = db;
    this.ulidFactory = ulidFactory;
  }

  async open() { await this.db.query('SELECT 1'); }
  async close() {}

  async append(tenant, messageCid, indexes) {
    const { did } = await scope(this.db, tenant);
    if (!indexes || !Object.keys(indexes).length) {
      throw new TypeError('DWN event indexes cannot be empty.');
    }
    const watermark = this.ulidFactory();
    const metadata = { indexes: { ...indexes, watermark }, watermark };
    const r = await this.db.query(
      `INSERT INTO public.dwn_storage
       (component_type,did,space_id,item_key,schema_uri,data_format,
        recipient,published,deleted,metadata,data_size,date_created,
        date_modified,updated_at)
       SELECT $3,u.did,u.space_id,$2,'milan/dwn-event','application/json',
              u.did,FALSE,FALSE,$4::jsonb,0,NOW(),NOW(),NOW()
       FROM public.users u WHERE u.did=$1 AND u.space_id IS NOT NULL
       ON CONFLICT (did,space_id,component_type,item_key)
       DO UPDATE SET metadata=EXCLUDED.metadata,date_modified=NOW(),updated_at=NOW()
       RETURNING id`,
      [did, String(messageCid), TYPES.event, JSON.stringify(metadata)]
    );
    if (r.rowCount !== 1) throw new Error('DWN event tenant mapping changed during storage.');
  }

  async queryEvents(tenant, filters, cursor) {
    const { did, spaceId } = await scope(this.db, tenant);
    const r = await this.db.query(
      `SELECT item_key,metadata FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3 AND deleted=FALSE`,
      [did, spaceId, TYPES.event]
    );
    let items = r.rows.map(row => ({
      messageCid: row.item_key,
      indexes: row.metadata?.indexes || {},
      watermark: row.metadata?.watermark || row.metadata?.indexes?.watermark
    })).filter(item => item.watermark && matchesAny(item.indexes, filters));

    items.sort((a, b) =>
      key(a.watermark, a.messageCid).localeCompare(key(b.watermark, b.messageCid))
    );

    if (cursor) {
      if (typeof cursor.messageCid !== 'string' || typeof cursor.value !== 'string') {
        throw new TypeError('Invalid DWN event cursor.');
      }
      const start = key(cursor.value, cursor.messageCid);
      items = items.filter(item => key(item.watermark, item.messageCid) > start);
    }

    const last = items[items.length - 1];
    return {
      events: items.map(item => item.messageCid),
      cursor: last ? { messageCid: last.messageCid, value: last.watermark } : undefined
    };
  }

  async getEvents(tenant, cursor) {
    return this.queryEvents(tenant, [], cursor);
  }

  async deleteEventsByCid(tenant, messageCids) {
    if (!Array.isArray(messageCids) || messageCids.length === 0) return;
    const { did, spaceId } = await scope(this.db, tenant);
    await this.db.query(
      `DELETE FROM public.dwn_storage
       WHERE did=$1 AND space_id=$2 AND component_type=$3 AND item_key=ANY($4::text[])`,
      [did, spaceId, TYPES.event, messageCids.map(String)]
    );
  }

  async clear() { await clearType(this.db, TYPES.event); }
}

class PostgresTenantGate {
  constructor({ db = defaultDb() } = {}) { this.db = db; }

  async isActiveTenant(tenant) {
    try {
      const did = validDid(tenant);
      const r = await this.db.query(
        'SELECT 1 FROM public.users WHERE did=$1 AND space_id IS NOT NULL LIMIT 1',
        [did]
      );
      return { isActiveTenant: r.rowCount === 1 };
    } catch (_error) {
      return { isActiveTenant: false, detail: 'Tenant registry validation is unavailable.' };
    }
  }
}

module.exports = {
  TYPES,
  PostgresMessageStore,
  PostgresDataStore,
  PostgresEventLog,
  PostgresTenantGate,
  matchesFilter,
  matchesAny,
  encode
};
