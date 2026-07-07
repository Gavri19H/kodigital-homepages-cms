// LeadGen ClickHouse HTTP client (design contract 08 §23/§24).
//
// A fresh, neutrally-named, fetch-based client for the CH Cloud HTTP interface.
// Ported IN PATTERN ONLY from the sibling analytics client — written from
// scratch here with leadgen-namespaced identifiers and zero shared symbols.
//
// Auth: the three worker SECRETS CH_URL / CH_USER / CH_PASSWORD (never in
// wrangler.toml [vars] — encrypted secrets, Dashboard/CI only). The CH instance
// is SHARED across products; leadgen simply queries the `lg_*` tables. We send
// the secrets as the X-ClickHouse-User / X-ClickHouse-Key headers, so the worker
// authenticates exactly like an operator's curl.
//
// Fail-open by design: when any of the three secrets is absent the client is
// UNCONFIGURED — `query` makes NO HTTP request and returns an empty, structured
// result. A configured query that fails (HTTP error / timeout / parse) throws a
// typed LeadgenChError so the caller's own try/catch can isolate it (mirror-sync
// isolates per table; the every-minute sync is fail-open).

import type { Env } from "../env";

export class LeadgenChError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message.length > 500 ? message.slice(0, 500) : message);
    this.name = "LeadgenChError";
    this.statusCode = statusCode;
  }
}

export interface LeadgenChQueryResult<T> {
  rows: T[];
  /** false ⇒ CH secrets absent, no HTTP request was made (structured no-op). */
  configured: boolean;
}

export interface LeadgenChClient {
  /** True when all three CH secrets are present. */
  readonly configured: boolean;
  /**
   * Run a read query (caller includes FINAL where dedup matters). Returns
   * parsed JSON rows. No-op empty result when unconfigured; throws
   * LeadgenChError on a configured-but-failed request.
   */
  query<T>(sql: string, params?: Record<string, string | number>): Promise<LeadgenChQueryResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** True when every CH secret the client needs is present + non-empty. */
export function chCredentialsConfigured(env: Partial<Env>): boolean {
  return Boolean(
    env.CH_URL && env.CH_URL.trim() !== "" &&
    env.CH_USER && env.CH_USER.trim() !== "" &&
    env.CH_PASSWORD && env.CH_PASSWORD.trim() !== "",
  );
}

// Client-side param substitution. Params here are only our own validated
// values (YYYY-MM-DD dates, entity public ids), but strings are still escaped
// so a stray quote can never break the query. {key} → 'escaped' | number.
function substituteParams(sql: string, params?: Record<string, string | number>): string {
  if (!params) return sql;
  let out = sql;
  for (const [key, value] of Object.entries(params)) {
    const replacement =
      typeof value === "number"
        ? String(value)
        : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    out = out.replaceAll(`{${key}}`, replacement);
  }
  return out;
}

export interface CreateChClientOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export function createLeadgenChClient(
  env: Partial<Env>,
  opts?: CreateChClientOptions,
): LeadgenChClient {
  const configured = chCredentialsConfigured(env);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts?.fetchImpl ?? fetch;
  // Normalize the base URL (trim a trailing slash so `${base}/?…` is clean).
  const baseUrl = (env.CH_URL ?? "").replace(/\/+$/, "");
  const user = env.CH_USER ?? "";
  const key = env.CH_PASSWORD ?? "";

  return {
    configured,
    async query<T>(sql: string, params?: Record<string, string | number>): Promise<LeadgenChQueryResult<T>> {
      if (!configured) {
        // Structured no-op: no network, empty rows, configured=false.
        return { rows: [], configured: false };
      }
      const fullSql = substituteParams(sql, params).trim().replace(/;?\s*$/, "") + " FORMAT JSONEachRow";
      // FINAL-aware + 64-bit ints as JSON numbers (not quoted strings) so
      // UInt64 counters map straight into D1 INTEGER columns.
      const settings: Record<string, string> = {
        do_not_merge_across_partitions_select_final: "1",
        output_format_json_quote_64bit_integers: "0",
      };
      const qs = Object.entries(settings).map(([k, v]) => `${k}=${v}`).join("&");
      const url = `${baseUrl}/?${qs}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await doFetch(url, {
          method: "POST",
          headers: {
            "X-ClickHouse-User": user,
            "X-ClickHouse-Key": key,
            "Content-Type": "text/plain; charset=utf-8",
          },
          body: fullSql,
          signal: controller.signal,
        });
        if (!resp.ok) {
          let body = "";
          try { body = await resp.text(); } catch { /* ignore */ }
          if (resp.status === 401 || resp.status === 403) {
            throw new LeadgenChError(`ClickHouse auth failed (${resp.status})`, resp.status);
          }
          throw new LeadgenChError(body || `ClickHouse HTTP ${resp.status}`, resp.status);
        }
        const text = await resp.text();
        if (text.trim() === "") return { rows: [], configured: true };
        const rows = text
          .trim()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as T);
        return { rows, configured: true };
      } catch (err) {
        if (err instanceof LeadgenChError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        // AbortError (timeout) + network errors surface as a typed 0-status error.
        throw new LeadgenChError(msg, 0);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
