import type { Env } from "../env";

const HOUR_MS = 3_600_000;
const WEEK_HOURS = 7 * 24;
const SITES_PER_BATCH = 50;
const MIN_EDGE_SAMPLES = 50;
const MIN_VITAL_SAMPLES = 20;
const MIN_VITAL_CLIENTS = 5;
const MAX_SAMPLES_PER_CLIENT = 3;
const PRUNED_HOUR_KEY = "speed:v1:last-pruned-hour";
const WEEKLY_REPORT_KEY = "speed:v1:last-weekly-report";
const WEEKLY_ATTEMPT_KEY = "speed:v1:last-weekly-attempt";
const vitals = ["LCP", "FCP", "INP", "CLS", "TTFB"] as const;
const pageTypes = ["home", "article", "category", "tag", "page", "listicle", "quote", "other"] as const;
const US_PHONES = "US phones";
const targets = { HIT: 90, LCP: 1500, FCP: undefined, INP: 100, CLS: 0.02, TTFB: 800 } as const;

interface Site { id: string; domain: string }
interface Reading {
  page_type: string;
  metric: (typeof vitals)[number] | "HIT";
  value: number | null; // Null when the window lacks enough eligible samples or clients.
  samples: number;
}

function offTarget(metric: Reading["metric"], value: number, target: number): boolean {
  return metric === "HIT" ? value < target : value > target;
}

function displayNumber(value: number, target?: number): string {
  // Keep weekly tables compact without rounding a threshold crossing back onto the target.
  const rounded = Number(value.toFixed(3));
  return String(rounded === target ? value : rounded);
}

async function readVitals(env: Env, sites: Site[], start: number, end: number, weekly: boolean): Promise<Map<string, Reading[]>> {
  // Cap visits before expanding their individual metrics. A client may report
  // an LCP but no INP. The weekly phone cohort pools the same capped visits.
  const rows = await env.DB.prepare(`WITH visits AS (
    SELECT site_id, page_type, client_key, country, device, lcp_ms, fcp_ms, inp_ms, cls, ttfb_ms,
      ROW_NUMBER() OVER (PARTITION BY site_id, page_type, client_key ORDER BY created_at, id) AS client_visit
    FROM vitals_samples
    WHERE site_id IN (SELECT value FROM json_each(?)) AND created_at >= ? AND created_at < ? AND client_key IS NOT NULL
  ), cohorts(phones) AS (
    VALUES (0) UNION ALL SELECT 1 WHERE ?
  ), metrics(metric) AS (
    VALUES ('LCP'), ('FCP'), ('INP'), ('CLS'), ('TTFB')
  ), observations AS (
    SELECT site_id, CASE WHEN phones THEN ? ELSE page_type END AS page_type, client_key, metric, CASE metric
      WHEN 'LCP' THEN lcp_ms WHEN 'FCP' THEN fcp_ms WHEN 'INP' THEN inp_ms
      WHEN 'CLS' THEN cls WHEN 'TTFB' THEN ttfb_ms END AS value
    FROM visits CROSS JOIN cohorts CROSS JOIN metrics
    WHERE client_visit <= ? AND (phones = 0 OR (country = 'US' AND device = 'mobile'))
  ), ranked AS (
    SELECT site_id, page_type, client_key, metric, value, ROW_NUMBER() OVER ordered AS position,
      COUNT(*) OVER (ordered ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS total
    FROM observations WHERE value IS NOT NULL
    WINDOW ordered AS (PARTITION BY site_id, page_type, metric ORDER BY value)
  )
  SELECT site_id, page_type, metric, COUNT(*) AS samples,
    CASE WHEN COUNT(*) >= ? AND COUNT(DISTINCT client_key) >= ?
      THEN MAX(value) FILTER (WHERE position = (3 * total + 3) / 4) END AS value
  FROM ranked GROUP BY site_id, page_type, metric
  ORDER BY site_id, page_type, metric`)
    .bind(JSON.stringify(sites.map(site => site.id)), start / 1000, end / 1000,
      Number(weekly), US_PHONES, MAX_SAMPLES_PER_CLIENT, MIN_VITAL_SAMPLES, MIN_VITAL_CLIENTS)
    .all<Reading & { site_id: string }>();
  const bySite = new Map<string, Reading[]>();
  for (const row of rows.results) {
    const readings = bySite.get(row.site_id);
    if (readings) readings.push(row);
    else bySite.set(row.site_id, [row]);
  }
  return bySite;
}

async function readHitShares(env: Env, sites: Site[], start: number, end: number): Promise<Map<string, Reading>> {
  const rows = await env.DB.prepare(`WITH visits AS (
    SELECT site_id, client_key, edge,
      ROW_NUMBER() OVER (PARTITION BY site_id, client_key ORDER BY created_at, id) AS client_visit
    FROM vitals_samples
    WHERE site_id IN (SELECT value FROM json_each(?)) AND created_at >= ? AND created_at < ?
      AND client_key IS NOT NULL AND edge IS NOT NULL
  )
  SELECT site_id, COUNT(*) AS samples,
    CASE WHEN COUNT(*) >= ? AND COUNT(DISTINCT client_key) >= ?
      THEN 100.0 * COUNT(*) FILTER (WHERE edge = 'HIT') / COUNT(*) END AS value
  FROM visits WHERE client_visit <= ? GROUP BY site_id`)
    .bind(JSON.stringify(sites.map(site => site.id)), start / 1000, end / 1000,
      MIN_EDGE_SAMPLES, MIN_VITAL_CLIENTS, MAX_SAMPLES_PER_CLIENT)
    .all<{ site_id: string; samples: number; value: number | null }>();
  const totals = new Map(rows.results.map(row => [row.site_id, row]));
  return new Map<string, Reading>(sites.map(({ id }) => {
    const row = totals.get(id);
    return [id, { page_type: "all pages", metric: "HIT", samples: row?.samples ?? 0, value: row?.value ?? null }];
  }));
}

function slackBotChannel(env: Env): string | undefined {
  return env.SLACK_BOT_TOKEN ? env.SLACK_ALERT_CHANNEL : undefined;
}

async function deliver(env: Env, text: string): Promise<boolean> {
  const channel = slackBotChannel(env);
  const url = channel ? "https://slack.com/api/chat.postMessage" : env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log(text);
    return true;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (channel) headers.Authorization = `Bearer ${env.SLACK_BOT_TOKEN}`;
  const request = {
    method: "POST",
    headers,
    body: JSON.stringify(channel ? { channel, text } : { text }),
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let delayMs = 500;
    try {
      const response = await fetch(url, request);
      if (channel && response.ok) {
        // chat.postMessage can reject a notification in an HTTP 200 response.
        const reply = await response.json<{ ok?: boolean }>().catch(() => null);
        if (reply?.ok === true) return true;
      } else {
        // Release the unread body before waiting or sending another transition.
        await response.body?.cancel().catch(() => {});
        if (response.ok) return true;
      }
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
        // Fetch errors can contain credentials.
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

function workerLabel(env: Env): string {
  const tag = env.CF_VERSION_METADATA?.tag;
  const worker = `worker ${env.CF_VERSION_METADATA?.id ?? "unknown"}`;
  return typeof tag === "string" && tag.length > 0 ? `release ${tag} · ${worker}` : worker;
}

function hitSummary(hit: Reading | null): string {
  if (!hit) return "edge HIT share unavailable";
  const value = hit.value === null
    ? "insufficient traffic from sampled real visitors"
    : `${displayNumber(hit.value, targets.HIT)}%${offTarget("HIT", hit.value, targets.HIT) ? "!" : ""}`;
  return `edge HIT share ${value} (${hit.samples} samples)`;
}

async function notifyChanges(env: Env, site: Site, hit: Reading | null, rows: Reading[] | null, end: number): Promise<void> {
  const readings = hit ? [hit] : [];
  // A successful query can return zero rows for a previously alarming page.
  // Check its existing state even then. A failed query leaves that state alone.
  if (rows) {
    const byMetric = new Map(rows.map(row => [`${row.page_type}:${row.metric}`, row]));
    for (const page_type of pageTypes) {
      for (const metric of vitals) {
        readings.push(byMetric.get(`${page_type}:${metric}`) ?? { page_type, metric, value: null, samples: 0 });
      }
    }
  }
  const checks = readings.flatMap(reading => {
    const target = targets[reading.metric];
    if (target === undefined) return [];
    return [{ reading, target, key: `speed:v1:state:${site.id}:${reading.page_type}:${reading.metric}` }];
  });
  if (!checks.length) return;
  const states = await env.CACHE.get(checks.map(check => check.key), "text");
  for (const { reading, target, key } of checks) {
    const [stored, previousHour, marker] = (states.get(key) ?? "").split(" ");
    if (Number(previousHour) >= end) continue;
    // Older "alarm <hour> gap" records last notified Slack of the data gap.
    const previous = marker === "gap" ? "nodata" : stored;
    const edge = reading.metric === "HIT";
    let state: "alarm" | "healthy" | "nodata";
    let headline: string;
    let detail: string;
    if (reading.value === null) {
      if (previous !== "alarm") continue;
      state = "nodata";
      headline = "Speed DATA GAP";
      detail = `${reading.metric} · ${reading.samples} samples (minimum ${edge ? MIN_EDGE_SAMPLES : MIN_VITAL_SAMPLES})`;
    } else {
      const alarm = offTarget(reading.metric, reading.value, target);
      state = alarm ? "alarm" : "healthy";
      if (previous === state || (!alarm && previous !== "alarm" && previous !== "nodata")) continue;
      headline = alarm ? "Speed ALARM" : "Speed RECOVERY";
      const unit = edge ? "%" : reading.metric === "CLS" ? "" : " ms";
      const metric = edge ? "edge HIT share" : `p75 ${reading.metric}`;
      detail = `${metric} ${displayNumber(reading.value, target)}${unit} · target ${edge ? "≥" : "≤"} ${target}${unit} · ${reading.samples} samples`;
    }
    const resuming = previous === "nodata" && state === "alarm";
    if (resuming) headline += " · data resumed";
    const text = [headline, siteLabel(site), reading.page_type, detail, workerLabel(env)].join(" · ");
    const alreadyResumed = marker === "resumed" && state !== "healthy";
    if (alreadyResumed || await deliver(env, text)) {
      try {
        const suffix = resuming || alreadyResumed ? " resumed" : "";
        await env.CACHE.put(key, `${state} ${end}${suffix}`);
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
  const pages = new Set(rows.filter(row => row.value !== null && row.page_type !== US_PHONES).map(row => row.page_type));
  pages.add(US_PHONES);
  for (const page of pages) {
    const cells = vitals.map(metric => {
      const row = byMetric.get(`${page}:${metric}`);
      if (!row || row.value === null) return "—";
      const target = targets[metric];
      return displayNumber(row.value, target) + (target !== undefined && offTarget(metric, row.value, target) ? "!" : "");
    });
    lines.push([page, ...cells].join("|"));
  }
  return lines.join("\n");
}

function weeklyReport(env: Env, start: number, end: number, sections: string[]): string {
  const header = [
    `Weekly speed report · ${new Date(start).toISOString()} to ${new Date(end).toISOString()} · ${workerLabel(env)}`,
    `Targets · Site-wide HIT ≥ ${targets.HIT}% · p75 LCP ≤ ${targets.LCP} ms (all page types), INP ≤ ${targets.INP} ms, CLS ≤ ${targets.CLS}, TTFB ≤ ${targets.TTFB} ms`,
    `! marks a missed target. — means fewer than ${MIN_VITAL_SAMPLES} samples or fewer than ${MIN_VITAL_CLIENTS} distinct clients. HIT share requires ${MIN_EDGE_SAMPLES} known cache outcomes from at least ${MIN_VITAL_CLIENTS} distinct clients.`,
  ].join("\n");
  const completeLegend = `Omitted page types have fewer than ${MIN_VITAL_SAMPLES} samples or fewer than ${MIN_VITAL_CLIENTS} distinct clients for every vital.`;
  const columns = "```\nPage|LCP ms|FCP ms|INP ms|CLS|TTFB ms";
  const completeOpening = [header, completeLegend, columns].join("\n");
  const text = [completeOpening, ...sections, "```"].join("\n");
  const limit = 40_000;
  if (text.length <= limit || (!env.SLACK_WEBHOOK_URL && !slackBotChannel(env))) return text;

  const shortSections = sections.map(section => section
    .replace(" · edge HIT share ", " · HIT ")
    .replace(/\((\d+) samples\)(?=\n|$)/, "(n=$1)"));
  const shorter = [completeOpening, ...shortSections, "```"].join("\n");
  if (shorter.length <= limit) return shorter;

  // Reserve space for all site headings, then their phone rows, before adding
  // page details. The same invocation logs each complete table.
  const notice = `This report exceeds Slack’s ${limit.toLocaleString("en-US")}-character limit. Workers Logs contain the complete tables for all ${sections.length} sites, including qualifying page rows omitted here.`;
  console.warn("[speed-alarms]", notice, header);
  for (const section of sections) console.log(section);
  const compact = shortSections.map(section => section.split("\n", 1)[0]!);
  const opening = [header, notice, columns].join("\n");
  const closing = "\n```";
  let spare = limit - opening.length - closing.length - compact.reduce((size, line) => size + 1 + line.length, 0);
  for (const [i, section] of shortSections.entries()) {
    const phones = section.split("\n").find(line => line.startsWith(`${US_PHONES}|`));
    if (phones && phones.length + 1 <= spare) {
      compact[i] += "\n" + phones;
      spare -= phones.length + 1;
    }
  }
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
  const minute = tick.getUTCMinutes();
  const hour = tick.getUTCHours();
  const weekly = tick.getUTCDay() === 1 && hour >= 6 && hour < 12 && minute % 15 === 0;
  if (!weekly && minute !== 5) return;
  const end = weekly ? tick.setUTCHours(6, 0, 0, 0) : Math.floor(scheduledTime / HOUR_MS) * HOUR_MS;
  const start = end - HOUR_MS * (weekly ? WEEK_HOURS : 1);

  try {
    if (weekly) {
      if (await lastWindow(env, WEEKLY_REPORT_KEY) >= end) return;
      const slot = Math.floor(scheduledTime / 60_000) * 60_000;
      if (await lastWindow(env, WEEKLY_ATTEMPT_KEY) >= slot) return;
      await env.CACHE.put(WEEKLY_ATTEMPT_KEY, String(slot));
    } else {
      const current = await startHourlyCheck(env, scheduledTime, end).catch(() => {
        console.error("[speed-alarms] Retention prune failed");
        return true;
      });
      if (!current) return;
    }
    const { results: sites } = await env.DB.prepare("SELECT id, domain FROM sites ORDER BY id").bind().all<Site>();
    const sections: string[] = [];
    for (let i = 0; i < sites.length; i += SITES_PER_BATCH) {
      const batch = sites.slice(i, i + SITES_PER_BATCH);
      const [hits, vitalsBySite] = await Promise.all([
        readHitShares(env, batch, start, end).catch(() => {
          console.error("[speed-alarms] Edge HIT share unavailable", batch.map(site => site.id));
          return null;
        }),
        readVitals(env, batch, start, end, weekly).catch(() => {
          console.error("[speed-alarms] Vitals unavailable", batch.map(site => site.id));
          return null;
        }),
      ]);
      for (const site of batch) {
        const hit = hits?.get(site.id) ?? null;
        const rows = vitalsBySite ? vitalsBySite.get(site.id) ?? [] : null;
        if (weekly) {
          sections.push(siteTable(site, hit, rows));
        } else {
          if (hit && hit.value === null) console.info(`[speed-alarms] ${siteLabel(site)} · ${hitSummary(hit)}`);
          await notifyChanges(env, site, hit, rows, end).catch(() => console.error("[speed-alarms] Alarm state unavailable", site.id));
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
