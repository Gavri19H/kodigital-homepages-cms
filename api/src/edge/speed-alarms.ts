import { EDGE_SAMPLE_WEIGHT, edgeHitCounterKey } from "../cache/cache-stats";
import type { Env } from "../env";

const HOUR_MS = 3_600_000;
const WEEK_HOURS = 7 * 24;
const SITES_PER_BATCH = 50;
const MIN_EDGE_SAMPLES = 50;
const MIN_VITAL_SAMPLES = 20;
const PRUNED_HOUR_KEY = "speed:v1:last-pruned-hour";
const WEEKLY_REPORT_KEY = "speed:v1:last-weekly-report";
const vitals = ["LCP", "FCP", "INP", "CLS", "TTFB"] as const;
const lcpPages = new Set(["home", "article", "listicle", "quote"]);
const targets = { HIT: 90, LCP: 2500, INP: 200, CLS: 0.02, TTFB: 800 } as const;

interface Site { id: string; domain: string }
interface Reading {
  page_type: string;
  metric: (typeof vitals)[number] | "HIT";
  value: number;
  samples: number;
}

function targetFor({ metric, page_type }: Reading): number | undefined {
  if (metric === "FCP" || (metric === "LCP" && !lcpPages.has(page_type))) return undefined;
  return targets[metric];
}

function offTarget(reading: Reading, target: number): boolean {
  return reading.metric === "HIT" ? reading.value < target : reading.value > target;
}

function displayNumber(value: number, target?: number): string {
  // Keep weekly tables compact without rounding a threshold crossing back onto the target.
  const rounded = Number(value.toFixed(3));
  return String(rounded === target ? value : rounded);
}

async function readVitals(env: Env, sites: Site[], start: number, end: number): Promise<Map<string, Reading[]>> {
  // One indexed time range per site. Rank each metric independently since
  // visitors can supply LCP without INP, and return only reportable p75s.
  const rows = await env.DB.prepare(`WITH metrics(metric) AS (
    VALUES ('LCP'), ('FCP'), ('INP'), ('CLS'), ('TTFB')
  ), observations AS (
    SELECT site_id, page_type, metric, CASE metric
      WHEN 'LCP' THEN lcp_ms WHEN 'FCP' THEN fcp_ms WHEN 'INP' THEN inp_ms
      WHEN 'CLS' THEN cls WHEN 'TTFB' THEN ttfb_ms END AS value
    FROM vitals_samples CROSS JOIN metrics
    WHERE site_id IN (SELECT value FROM json_each(?)) AND created_at >= ? AND created_at < ?
  ), ranked AS (
    SELECT site_id, page_type, metric, value, ROW_NUMBER() OVER ordered AS position,
      COUNT(*) OVER (ordered ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS samples
    FROM observations WHERE value IS NOT NULL
    WINDOW ordered AS (PARTITION BY site_id, page_type, metric ORDER BY value)
  )
  SELECT site_id, page_type, metric, value, samples FROM ranked
  WHERE position = (3 * samples + 3) / 4 AND samples >= ?
  ORDER BY site_id, page_type, metric`)
    .bind(JSON.stringify(sites.map(site => site.id)), start / 1000, end / 1000, MIN_VITAL_SAMPLES)
    .all<Reading & { site_id: string }>();
  const bySite = new Map<string, Reading[]>();
  for (const row of rows.results) {
    const readings = bySite.get(row.site_id);
    if (readings) readings.push(row);
    else bySite.set(row.site_id, [row]);
  }
  return bySite;
}

async function weeklyCounterKeys(env: Env): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown> = await env.CACHE.list({ prefix: "edgehit:v1:", cursor });
    for (const key of page.keys) keys.add(key.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function readHitShares(
  env: Env, sites: Site[], start: number, end: number, existingKeys?: Set<string>,
): Promise<Map<string, Reading>> {
  const totals = new Map(sites.map(site => [site.id, { hits: 0, samples: 0 }]));
  const requests: { key: string; siteId: string; hit: boolean }[] = [];
  for (const { id } of sites) {
    for (let hour = start; hour < end; hour += HOUR_MS) {
      for (const outcome of ["HIT", "MISS"] as const) {
        const key = edgeHitCounterKey(id, hour, outcome);
        if (!existingKeys || existingKeys.has(key)) requests.push({ key, siteId: id, hit: outcome === "HIT" });
      }
    }
  }
  // Pack multiple sites into each KV bulk read (up to 100 keys). A missing
  // counter is zero. An unreadable counter invalidates only its site's share.
  for (let i = 0; i < requests.length; i += 100) {
    const batch = requests.slice(i, i + 100);
    const counters = await env.CACHE.get(batch.map(request => request.key), "text").catch(() => null);
    for (const { key, siteId, hit } of batch) {
      const total = totals.get(siteId);
      if (!total) continue;
      const raw = counters?.get(key);
      if (counters && raw == null) continue;
      const observed = Number(raw) / EDGE_SAMPLE_WEIGHT;
      if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(observed)) {
        totals.delete(siteId);
        console.error("[speed-alarms] Edge counts unavailable", siteId);
        continue;
      }
      total.samples += observed;
      if (hit) total.hits += observed;
    }
  }
  return new Map<string, Reading>([...totals].map(([siteId, { hits, samples }]) => [
    siteId, { page_type: "all pages", metric: "HIT", samples, value: samples ? 100 * hits / samples : 0 },
  ]));
}

async function deliver(env: Env, text: string): Promise<boolean> {
  if (!env.SLACK_WEBHOOK_URL) {
    console.log(text);
    return true;
  }
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let delayMs = 500;
    try {
      const response = await fetch(env.SLACK_WEBHOOK_URL, request);
      // Release this connection before waiting or sending another transition.
      await response.body?.cancel().catch(() => {});
      if (response.ok) return true;
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) {
        console.error("[speed-alarms] Slack rejected the notification", response.status);
        break;
      }
      const retryAfter = response.headers.get("Retry-After");
      if (response.status === 429 && retryAfter && /^\d+$/.test(retryAfter)) {
        delayMs = Number(retryAfter) * 1000;
        if (delayMs > 30_000) {
          console.error("[speed-alarms] Slack rate limit exceeds the in-tick retry window");
          break;
        }
      }
    } catch {
      if (attempt === 2) {
        // Fetch errors can contain the secret webhook URL.
        console.error("[speed-alarms] Slack delivery failed");
        break;
      }
    }
    if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

function siteLabel(site: Site): string {
  return site.domain ? `${site.domain} (${site.id})` : site.id;
}

function hitSummary(hit: Reading | null): string {
  if (!hit) return "edge HIT share unavailable";
  const value = hit.samples < MIN_EDGE_SAMPLES
    ? "insufficient traffic"
    : `${displayNumber(hit.value, targets.HIT)}%${offTarget(hit, targets.HIT) ? "!" : ""}`;
  return `edge HIT share ${value} (${hit.samples} samples)`;
}

async function notifyChanges(env: Env, site: Site, readings: Reading[], end: number): Promise<void> {
  const checks = readings.flatMap(reading => {
    const target = targetFor(reading);
    if (target === undefined || reading.samples < (reading.metric === "HIT" ? MIN_EDGE_SAMPLES : MIN_VITAL_SAMPLES)) return [];
    return [{ reading, target, key: `speed:v1:state:${site.id}:${reading.page_type}:${reading.metric}` }];
  });
  if (!checks.length) return;
  const states = await env.CACHE.get(checks.map(check => check.key), "text");
  for (const { reading, target, key } of checks) {
    const [previous, previousHour] = (states.get(key) ?? "").split(" ");
    const alarm = offTarget(reading, target);
    if ((previous === "alarm") === alarm || Number(previousHour) >= end) continue;

    const edge = reading.metric === "HIT";
    const unit = edge ? "%" : reading.metric === "CLS" ? "" : " ms";
    const metric = edge ? "edge HIT share" : `p75 ${reading.metric}`;
    const text = [
      alarm ? "Speed ALARM" : "Speed RECOVERY", siteLabel(site), reading.page_type,
      `${metric} ${displayNumber(reading.value, target)}${unit}`, `target ${edge ? "≥" : "≤"} ${target}${unit}`,
      `${reading.samples} samples`, `worker ${env.CF_VERSION_METADATA?.id ?? "unknown"}`,
    ].join(" · ");
    // A rejected POST leaves the last delivered state intact for the next check.
    if (await deliver(env, text)) {
      try {
        await env.CACHE.put(key, `${alarm ? "alarm" : "healthy"} ${end}`);
      } catch {
        console.error("[speed-alarms] Alarm state write failed", site.id, reading.page_type, reading.metric);
      }
    }
  }
}

function siteTable(site: Site, hit: Reading | null, rows: Reading[] | null): string {
  const heading = `${siteLabel(site)} · ${hitSummary(hit)}`;
  if (!rows) return `${heading}\nVitals unavailable.`;
  const byMetric = new Map(rows.map(row => [`${row.page_type}:${row.metric}`, row]));
  const lines = [heading];
  for (const page of new Set(rows.map(row => row.page_type))) {
    const cells = vitals.map(metric => {
      const row = byMetric.get(`${page}:${metric}`);
      if (!row) return "—";
      const target = targetFor(row);
      return displayNumber(row.value, target) + (target !== undefined && offTarget(row, target) ? "!" : "");
    });
    lines.push([page, ...cells].join("|"));
  }
  return lines.join("\n");
}

function weeklyReport(env: Env, start: number, end: number, sections: string[]): string {
  const header = [
    `Weekly speed report · ${new Date(start).toISOString()} to ${new Date(end).toISOString()} · worker ${env.CF_VERSION_METADATA?.id ?? "unknown"}`,
    `Targets · Site-wide HIT ≥ ${targets.HIT}% · p75 LCP ≤ ${targets.LCP} ms (home, article, listicle, quote), INP ≤ ${targets.INP} ms, CLS ≤ ${targets.CLS}, TTFB ≤ ${targets.TTFB} ms`,
    `! marks a missed target. — means fewer than ${MIN_VITAL_SAMPLES} samples. HIT share requires ${MIN_EDGE_SAMPLES} samples.`,
  ].join("\n");
  const completeLegend = `Omitted page types have fewer than ${MIN_VITAL_SAMPLES} samples for every vital.`;
  const columns = "```\nPage|LCP ms|FCP ms|INP ms|CLS|TTFB ms";
  const completeOpening = [header, completeLegend, columns].join("\n");
  const text = [completeOpening, ...sections, "```"].join("\n");
  const limit = 40_000;
  if (!env.SLACK_WEBHOOK_URL || text.length <= limit) return text;

  const shortSections = sections.map(section => section
    .replace(" · edge HIT share ", " · HIT ")
    .replace(/\((\d+) samples\)(?=\n|$)/, "(n=$1)"));
  const shorter = [completeOpening, ...shortSections, "```"].join("\n");
  if (shorter.length <= limit) return shorter;

  // Keep site headings first in the size budget. Publish full tables in the
  // same invocation's logs when Slack cannot carry every row in one message.
  const notice = `This report exceeds Slack’s ${limit.toLocaleString("en-US")}-character limit. Workers Logs contain the complete tables for all ${sections.length} sites, including qualifying page rows omitted here.`;
  console.warn("[speed-alarms]", notice, header);
  for (const section of sections) console.log(section);
  const compact = shortSections.map(section => section.split("\n", 1)[0]!);
  const opening = [header, notice, columns].join("\n");
  const closing = "\n```";
  let spare = limit - opening.length - closing.length - compact.reduce((size, line) => size + 1 + line.length, 0);
  for (const [i, section] of shortSections.entries()) {
    const detailSize = section.length - compact[i]!.length;
    if (detailSize <= spare) {
      compact[i] = section;
      spare -= detailSize;
    }
  }
  const body = [opening, ...compact].join("\n");
  if (body.length + closing.length <= limit) return body + closing;
  return body.slice(0, body.lastIndexOf("\n", limit - closing.length)) + closing;
}

async function lastWindow(env: Env, key: string): Promise<number> {
  const last = await env.CACHE.get(key);
  return last === null ? -Infinity : Number(last);
}

async function startHourlyCheck(env: Env, scheduledTime: number, end: number): Promise<boolean> {
  const last = await lastWindow(env, PRUNED_HOUR_KEY);
  if (last >= end) return last === end; // Retry this hour, ignore a delayed older tick.
  // Reserve this hour before starting the DELETE. Failed prunes can wait for the next hour.
  await env.CACHE.put(PRUNED_HOUR_KEY, String(end));
  const cutoff = Math.floor(scheduledTime / 1000) - 14 * 24 * 3600;
  await env.DB.prepare("DELETE FROM vitals_samples WHERE created_at < ?").bind(cutoff).run();
  return true;
}

export async function runSpeedAlarms(env: Env, scheduledTime: number): Promise<void> {
  const tick = new Date(scheduledTime);
  const weekly = tick.getUTCDay() === 1 && tick.getUTCHours() === 6 && tick.getUTCMinutes() === 0;
  if (!weekly && tick.getUTCMinutes() !== 5) return;
  const end = Math.floor(scheduledTime / HOUR_MS) * HOUR_MS;
  const start = end - HOUR_MS * (weekly ? WEEK_HOURS : 1);

  try {
    if (weekly && await lastWindow(env, WEEKLY_REPORT_KEY) >= end) return;
    if (!weekly) {
      const current = await startHourlyCheck(env, scheduledTime, end).catch(() => {
        console.error("[speed-alarms] Retention prune failed");
        return true;
      });
      if (!current) return;
    }
    const { results: sites } = await env.DB.prepare("SELECT id, domain FROM sites ORDER BY id").bind().all<Site>();
    const sections: string[] = [];
    // The weekly range is typically sparse. List the retained keys once, with
    // direct reads as the fallback when a KV listing is unavailable.
    const existingKeys = weekly ? await weeklyCounterKeys(env).catch(() => undefined) : undefined;
    for (let i = 0; i < sites.length; i += SITES_PER_BATCH) {
      const batch = sites.slice(i, i + SITES_PER_BATCH);
      const [hits, vitalsBySite] = await Promise.all([
        readHitShares(env, batch, start, end, existingKeys),
        readVitals(env, batch, start, end).catch(() => {
          console.error("[speed-alarms] Vitals unavailable", batch.map(site => site.id));
          return null;
        }),
      ]);
      for (const site of batch) {
        const hit = hits.get(site.id) ?? null;
        const rows = vitalsBySite ? vitalsBySite.get(site.id) ?? [] : null;
        if (weekly) {
          sections.push(siteTable(site, hit, rows));
        } else {
          if (hit && hit.samples < MIN_EDGE_SAMPLES) console.info(`[speed-alarms] ${siteLabel(site)} · ${hitSummary(hit)}`);
          const readings = rows ?? [];
          if (hit) readings.push(hit);
          await notifyChanges(env, site, readings, end).catch(() => console.error("[speed-alarms] Alarm state unavailable", site.id));
        }
      }
    }
    if (weekly) {
      if (await deliver(env, weeklyReport(env, start, end, sections))) await env.CACHE.put(WEEKLY_REPORT_KEY, String(end));
    }
  } catch {
    console.error("[speed-alarms] Scheduled speed check failed");
  }
}
