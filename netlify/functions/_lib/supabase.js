/**
 * _lib/supabase.js  — Neon/pg drop-in replacement for @supabase/supabase-js
 *
 * Exposes the same API surface that all 55 Netlify functions use:
 *   supabaseAdmin()  → returns a QueryBuilder bound to a pg Pool
 *
 * Supported chain methods (everything actually used in this codebase):
 *   .from(table)
 *   .select(cols, opts?)          opts: { count: "exact", head: true }
 *   .insert(obj)
 *   .update(patch)
 *   .upsert(obj, { onConflict })
 *   .delete()
 *   .eq(col, val)
 *   .neq(col, val)
 *   .in(col, arr)
 *   .is(col, val)                 null / not-null checks
 *   .filter(col, "not.is", "null")
 *   .contains(col, arr)           array @> $1
 *   .order(col, { ascending })
 *   .limit(n)
 *   .single()                     error if 0 rows
 *   .maybeSingle()                null if 0 rows, no error
 *   .then() / await               executes the query
 *
 * Join syntax in .select() strings is parsed and rewritten as SQL JOINs:
 *   "*, profiles(display_name)"
 *   "*, profiles!fk_name(col1, col2)"
 *   "*, listings!inner(col)"       — INNER JOIN
 *   nested: "offers(*, profiles(display_name))"
 */

import pkg from "pg";
const { Pool } = pkg;

import { randomBytes, createHash, scryptSync, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";

// ─── Postgres pool ────────────────────────────────────────────────────────────

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL env var");
  _pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10000 });
  return _pool;
}

// ─── Redis (unchanged) ───────────────────────────────────────────────────────

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// ─── Join / select parser ─────────────────────────────────────────────────────
//
// Parses Supabase's PostgREST select syntax into SQL JOIN clauses + column
// lists. Handles one level of nesting (which is all this codebase uses).
//
// Examples:
//   "*, profiles(display_name, rbx_avatar_url)"
//   "*, profiles!build_registry_profile_id_fkey(display_name)"
//   "*, listings!inner(id, profile_id)"
//   "id, offers!inner(offering_profile_id)"
//   "id, listings(id, title, status, house_id, profiles(display_name))"  ← nested

function parseSelect(table, selectStr, knownFKs) {
  if (!selectStr || selectStr.trim() === "") {
    return { cols: [`"${table}".*`], joins: [], aliases: {} };
  }

  const cols    = [];
  const joins   = [];
  const aliases = {}; // relationName -> alias used in SQL

  // Split top-level tokens (respecting parentheses)
  const tokens = splitTopLevel(selectStr);

  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;

    // Does this token contain a sub-select? e.g. "profiles(col1, col2)"
    const parenIdx = t.indexOf("(");
    if (parenIdx !== -1) {
      // relation token: name!hint(cols) or name(cols)
      const head      = t.slice(0, parenIdx);          // "profiles!fk_name" or "offers!inner"
      const innerStr  = t.slice(parenIdx + 1, -1);     // "col1, col2, ..."

      const bangIdx   = head.indexOf("!");
      const relName   = bangIdx === -1 ? head : head.slice(0, bangIdx);
      const hint      = bangIdx === -1 ? ""   : head.slice(bangIdx + 1);
      const isInner   = hint === "inner";
      const alias     = `_j_${relName}`;
      aliases[relName] = alias;

      // Determine the JOIN ON condition
      // Priority: known FK map → hint as FK name → relName_id convention
      const fkCol = knownFKs?.[`${table}.${relName}`]
                 || (hint && hint !== "inner" ? hint : null)
                 || `${relName}_id`;

      const joinType = isInner ? "INNER JOIN" : "LEFT JOIN";
      joins.push(`${joinType} "${relName}" AS ${alias} ON ${alias}.id = "${table}"."${fkCol}"`);

      // Check for nested sub-select inside (e.g. offers(*, profiles(display_name)))
      const innerTokens = splitTopLevel(innerStr);
      for (const inner of innerTokens) {
        const it = inner.trim();
        if (!it) continue;
        const ip = it.indexOf("(");
        if (ip !== -1) {
          // Nested relation — one more level
          const iHead    = it.slice(0, ip);
          const iInner   = it.slice(ip + 1, -1);
          const iBang    = iHead.indexOf("!");
          const iRelName = iBang === -1 ? iHead : iHead.slice(0, iBang);
          const iHint    = iBang === -1 ? ""    : iHead.slice(iBang + 1);
          const iIsInner = iHint === "inner";
          const iAlias   = `_j2_${iRelName}`;
          aliases[`${relName}.${iRelName}`] = iAlias;

          const iFkCol = knownFKs?.[`${relName}.${iRelName}`]
                      || (iHint && iHint !== "inner" ? iHint : null)
                      || `${iRelName}_id`;
          const iJoinType = iIsInner ? "INNER JOIN" : "LEFT JOIN";
          joins.push(`${iJoinType} "${iRelName}" AS ${iAlias} ON ${iAlias}.id = ${alias}."${iFkCol}"`);

          const iCols = iInner === "*"
            ? [`row_to_json(${iAlias}.*)`]
            : iInner.split(",").map(c => c.trim()).filter(Boolean)
                    .map(c => `${iAlias}."${c}"`);
          // We'll bundle inner relation cols into the outer json_build_object below
          aliases[`${relName}.${iRelName}._cols`] = iCols.join(", ");
        } else if (it === "*") {
          aliases[`${relName}._star`] = true;
        } else {
          // Plain column for outer relation
          if (!aliases[`${relName}._plainCols`]) aliases[`${relName}._plainCols`] = [];
          aliases[`${relName}._plainCols`].push(it);
        }
      }

      // Build the column expression for this relation as a JSON object
      cols.push(buildRelationCol(relName, alias, innerStr, aliases, knownFKs));

    } else if (t === "*") {
      cols.push(`"${table}".*`);
    } else {
      cols.push(`"${table}"."${t}"`);
    }
  }

  if (cols.length === 0) cols.push(`"${table}".*`);

  return { cols, joins, aliases };
}

function buildRelationCol(relName, alias, innerStr, aliases, knownFKs) {
  const innerTokens = splitTopLevel(innerStr);
  const jsonPairs   = [];

  for (const inner of innerTokens) {
    const it = inner.trim();
    if (!it) continue;
    const ip = it.indexOf("(");
    if (ip !== -1) {
      // Nested relation — emit as JSON sub-object
      const iHead    = it.slice(0, ip);
      const iInner   = it.slice(ip + 1, -1);
      const iBang    = iHead.indexOf("!");
      const iRelName = iBang === -1 ? iHead : iHead.slice(0, iBang);
      const iAlias   = aliases[`${relName}.${iRelName}`] || `_j2_${iRelName}`;

      const iTokens  = splitTopLevel(iInner);
      const iCols    = iTokens.map(c => c.trim()).filter(c => c && c !== "*");
      if (iCols.length === 0 || iInner.trim() === "*") {
        jsonPairs.push(`'${iRelName}', row_to_json(${iAlias})`);
      } else {
        const iPairs = iCols.map(c => `'${c}', ${iAlias}."${c}"`).join(", ");
        jsonPairs.push(`'${iRelName}', json_build_object(${iPairs})`);
      }
    } else if (it === "*") {
      // Star inside relation — use row_to_json and spread
      jsonPairs.push(`'__star__', row_to_json(${alias})`);
    } else {
      jsonPairs.push(`'${it}', ${alias}."${it}"`);
    }
  }

  // If there's a star marker, emit row_to_json for whole relation
  const hasStar = jsonPairs.some(p => p.includes("'__star__'"));
  let expr;
  if (hasStar) {
    const extras = jsonPairs.filter(p => !p.includes("'__star__'"));
    if (extras.length === 0) {
      expr = `row_to_json(${alias})`;
    } else {
      // Merge row_to_json with extras
      expr = `(SELECT row_to_json(${alias}) || json_build_object(${extras.join(", ")})::jsonb)`;
    }
  } else {
    expr = `json_build_object(${jsonPairs.join(", ")})`;
  }

  return `${expr} AS "${relName}"`;
}

// Split a comma-separated string respecting nested parentheses
function splitTopLevel(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if      (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (str[i] === "," && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

// ─── Known FK overrides ──────────────────────────────────────────────────────
// Only needed where the FK column name doesn't follow the `relationName_id` pattern.
// Format: "parentTable.relationAlias" -> "actual_fk_column_on_parentTable"

const FK_MAP = {
  // commission_requests uses two separate FKs to profiles
  "commission_requests.profiles": "requester_profile_id",  // default; overridden by hint in practice
  // build_registry_disputes joins to build_registry
  "build_registry_disputes.build_registry": "build_registry_id",
  // listings -> profiles
  "listings.profiles": "profile_id",
  // offers -> profiles
  "offers.profiles": "offering_profile_id",
  // build_registry -> profiles
  "build_registry.profiles": "profile_id",
  // completed_trades -> listings
  "completed_trades.listings": "listing_id",
  // completed_trades -> offers
  "completed_trades.offers": "offer_id",
  // listing_saves -> listings
  "listing_saves.listings": "listing_id",
  // registry_saves -> build_registry
  "registry_saves.build_registry": "build_registry_id",
  // content_submissions -> profiles
  "content_submissions.profiles": "profile_id",
  // trade_chat_messages -> profiles
  "trade_chat_messages.profiles": "profile_id",
  // data_team_applications -> profiles
  "data_team_applications.profiles": "profile_id",
  // notifications -> profiles
  "notifications.profiles": "profile_id",
  // reports -> listings
  "reports.listings": "listing_id",
  // sessions -> profiles
  "sessions.profiles": "profile_id",
};

// ─── QueryBuilder ─────────────────────────────────────────────────────────────

class QueryBuilder {
  constructor(pool, table) {
    this._pool    = pool;
    this._table   = table;
    this._op      = "select";       // select | insert | update | upsert | delete
    this._select  = "*";
    this._countOnly  = false;       // { count: "exact", head: true }
    this._wheres  = [];             // { sql, val }[]
    this._params  = [];
    this._order   = null;
    this._limitN  = null;
    this._single  = false;
    this._maybeSingle = false;
    this._insertData  = null;
    this._updateData  = null;
    this._upsertConflict = null;
    this._returning = false;
  }

  // ── Operation setters ──────────────────────────────────────────────────────

  select(cols = "*", opts = {}) {
    this._op = "select";
    this._select = cols;
    if (opts?.count === "exact" && opts?.head) this._countOnly = true;
    return this;
  }

  insert(data) {
    this._op = "insert";
    this._insertData = data;
    return this;
  }

  update(patch) {
    this._op = "update";
    this._updateData = patch;
    return this;
  }

  upsert(data, opts = {}) {
    this._op = "upsert";
    this._insertData = data;
    this._upsertConflict = opts.onConflict || null;
    return this;
  }

  delete() {
    this._op = "delete";
    return this;
  }

  // ── Filter chain ───────────────────────────────────────────────────────────

  eq(col, val) {
    this._wheres.push({ sql: `"${this._table}"."${col}" = $__`, val });
    return this;
  }

  neq(col, val) {
    this._wheres.push({ sql: `"${this._table}"."${col}" != $__`, val });
    return this;
  }

  in(col, arr) {
    this._wheres.push({ sql: `"${this._table}"."${col}" = ANY($__)`, val: arr });
    return this;
  }

  is(col, val) {
    if (val === null) {
      this._wheres.push({ sql: `"${this._table}"."${col}" IS NULL`, val: null, noParam: true });
    } else {
      this._wheres.push({ sql: `"${this._table}"."${col}" IS NOT NULL`, val: null, noParam: true });
    }
    return this;
  }

  filter(col, op, val) {
    if (op === "not.is" && val === "null") {
      this._wheres.push({ sql: `"${this._table}"."${col}" IS NOT NULL`, val: null, noParam: true });
    } else if (op === "is" && val === "null") {
      this._wheres.push({ sql: `"${this._table}"."${col}" IS NULL`, val: null, noParam: true });
    } else {
      // Fallback — shouldn't be hit in practice
      this._wheres.push({ sql: `"${this._table}"."${col}" ${op} $__`, val });
    }
    return this;
  }

  contains(col, arr) {
    // Postgres: array @> ARRAY[$1] — checks that col contains all elements of arr
    this._wheres.push({ sql: `"${this._table}"."${col}" @> $__`, val: arr });
    return this;
  }

  order(col, opts = {}) {
    const dir = opts.ascending === false ? "DESC" : "ASC";
    this._order = `"${this._table}"."${col}" ${dir}`;
    return this;
  }

  limit(n) {
    this._limitN = n;
    return this;
  }

  single() {
    this._single = true;
    this._returning = true;
    return this;
  }

  maybeSingle() {
    this._maybeSingle = true;
    this._limitN = 1;
    return this;
  }

  // Calling .select() after .insert()/.update() means RETURNING *
  // We detect this by re-calling select() in those chains.
  // We handle it: if _returning=true and op=insert/update/upsert we add RETURNING *.

  // ── Query execution ────────────────────────────────────────────────────────

  async _execute() {
    const pool = this._pool;
    let sql, params;

    try {
      ({ sql, params } = this._build());
    } catch (err) {
      return { data: null, error: { message: `Query build error: ${err.message}` }, count: null };
    }

    try {
      const result = await pool.query(sql, params);

      if (this._countOnly) {
        return { data: null, error: null, count: parseInt(result.rows[0]?.count ?? 0, 10) };
      }

      const rows = result.rows.map(deserializeRow);

      if (this._single) {
        if (rows.length === 0) return { data: null, error: { message: "No rows returned", code: "PGRST116" } };
        return { data: rows[0], error: null };
      }
      if (this._maybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }

      return { data: rows, error: null };
    } catch (err) {
      console.error(`[neon-db] Query failed on "${this._table}":`, err.message, "\nSQL:", sql);
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  _build() {
    // Assign parameter placeholders
    const params  = [];
    const nextPh  = (val) => { params.push(val); return `$${params.length}`; };

    // Build WHERE clause
    const whereParts = this._wheres.map(w => {
      if (w.noParam) return w.sql;
      return w.sql.replace("$__", nextPh(w.val));
    });
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    let sql;

    if (this._op === "select") {
      if (this._countOnly) {
        sql = `SELECT COUNT(*) AS count FROM "${this._table}" ${where}`;
      } else {
        const { cols, joins } = parseSelect(this._table, this._select, FK_MAP);
        const joinSQL = joins.join(" ");
        const orderSQL = this._order ? `ORDER BY ${this._order}` : "";
        const limitSQL = this._limitN != null ? `LIMIT ${this._limitN}` : "";
        sql = `SELECT ${cols.join(", ")} FROM "${this._table}" ${joinSQL} ${where} ${orderSQL} ${limitSQL}`.trim();
      }

    } else if (this._op === "insert") {
      const data  = this._insertData;
      const keys  = Object.keys(data);
      const vals  = keys.map(k => nextPh(data[k]));
      const ret   = this._returning || this._single || this._maybeSingle ? "RETURNING *" : "";
      sql = `INSERT INTO "${this._table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${vals.join(", ")}) ${ret}`;

    } else if (this._op === "update") {
      const data  = this._updateData;
      const keys  = Object.keys(data);
      const sets  = keys.map(k => `"${k}" = ${nextPh(data[k])}`).join(", ");
      const ret   = this._returning || this._single || this._maybeSingle ? "RETURNING *" : "";
      sql = `UPDATE "${this._table}" SET ${sets} ${where} ${ret}`;

    } else if (this._op === "upsert") {
      const data    = this._insertData;
      const keys    = Object.keys(data);
      const vals    = keys.map(k => nextPh(data[k]));
      const conflict = this._upsertConflict ? `("${this._upsertConflict}")` : "";
      const updates  = keys.filter(k => k !== this._upsertConflict)
                           .map(k => `"${k}" = EXCLUDED."${k}"`).join(", ");
      const ret     = this._returning || this._single || this._maybeSingle ? "RETURNING *" : "";
      sql = `INSERT INTO "${this._table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT ${conflict} DO UPDATE SET ${updates} ${ret}`;

    } else if (this._op === "delete") {
      sql = `DELETE FROM "${this._table}" ${where}`;

    } else {
      throw new Error(`Unknown op: ${this._op}`);
    }

    return { sql: sql.replace(/\s+/g, " ").trim(), params };
  }

  // Make QueryBuilder thenable (await db.from(...).select()...)
  then(resolve, reject) {
    // Detect chained .select() after insert/update (means RETURNING *)
    if ((this._op === "insert" || this._op === "update" || this._op === "upsert") && this._select !== "*") {
      this._returning = true;
    }
    return this._execute().then(resolve, reject);
  }
}

// Deserialize Postgres row: JSON string columns come back as objects already
// via pg's built-in JSON parsing. Arrays too. Nothing extra needed.
function deserializeRow(row) {
  return row;
}

// ─── NeonDB facade ───────────────────────────────────────────────────────────

class NeonDB {
  constructor(pool) {
    this._pool = pool;
  }

  from(table) {
    const qb = new QueryBuilder(this._pool, table);
    // Intercept chained .select() after .insert/.update to set _returning
    const origInsert = qb.insert.bind(qb);
    const origUpdate = qb.update.bind(qb);
    const origUpsert = qb.upsert.bind(qb);

    qb.insert = (data) => {
      origInsert(data);
      const origSelect = qb.select.bind(qb);
      qb.select = (cols, opts) => { qb._returning = true; return origSelect(cols, opts); };
      return qb;
    };
    qb.update = (patch) => {
      origUpdate(patch);
      const origSelect = qb.select.bind(qb);
      qb.select = (cols, opts) => { qb._returning = true; return origSelect(cols, opts); };
      return qb;
    };
    qb.upsert = (data, opts) => {
      origUpsert(data, opts);
      const origSelect = qb.select.bind(qb);
      qb.select = (cols, opts2) => { qb._returning = true; return origSelect(cols, opts2); };
      return qb;
    };

    return qb;
  }
}

// ─── Public API (same exports as before) ─────────────────────────────────────

export function supabaseAdmin() {
  return new NeonDB(getPool());
}

// ── Auth helpers (unchanged) ──────────────────────────────────────────────────

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function newSecretSalt() {
  return randomBytes(16).toString("hex");
}

export function hashSecret(secret, salt) {
  return scryptSync(String(secret), salt, 64).toString("hex");
}

export function verifySecret(secret, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual   = Buffer.from(hashSecret(secret, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function requireProfile(event) {
  const auth  = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;

  const db        = supabaseAdmin();
  const tokenHash = hashToken(token);
  const cacheKey  = `session:${tokenHash}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
    } catch (err) {
      console.warn("Session cache read failed (non-fatal):", err.message);
    }
  }

  const { data: session } = await db
    .from("sessions")
    .select("profile_id, profiles(*)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session?.profiles) return null;

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(session.profiles), { ex: 300 });
    } catch (err) {
      console.warn("Session cache write failed (non-fatal):", err.message);
    }
  }

  db.from("sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .then(() => {});

  return session.profiles;
}

export function requireAdmin(event) {
  const provided = event.headers["x-admin-password"] || event.headers["X-Admin-Password"];
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && provided === expected;
}

export async function notify(db, profile_id, type, message, link = null) {
  try {
    await db.from("notifications").insert({ profile_id, type, message, link });
  } catch (err) {
    console.error(`notify(${type}) failed (non-fatal):`, err);
  }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function safeHandler(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      console.error("Unhandled function error:", err);
      const message =
        err?.message?.includes("DATABASE_URL")
          ? "Server misconfigured: DATABASE_URL environment variable isn't set. Check Netlify's Site settings → Environment variables."
          : "Something went wrong on our end. Try again in a moment.";
      return json(500, { error: message });
    }
  };
}
