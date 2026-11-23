# Vehicle list (F18): the yearly refresh

The car insurance funnel asks for the visitor's car **make, model year and model**. Those answers come from our own copy of the US government vehicle list (NHTSA vPIC). This folder holds the tools that build that copy once a year, check it, and put it live.

There is no database. Each yearly copy (a **snapshot**, named by its build date, e.g. `2026-11-23`) is a set of small ready-made JSON files. The CMS Worker serves them from its R2 bucket (binding `MEDIA`) under `vehicles/`, cached for a year. Exactly one snapshot is live; the one-line file `vehicles/live.json` says which.

## What is here

| File | What it is |
|---|---|
| `ingest.ts` | Builds a snapshot from vPIC (makes and models) and EPA FuelEconomy.gov (which makes are consumer brands). |
| `checks.ts` | The QA checks (AC1–AC6, featured makes, file checks, sizes), the 2% guardrail, the diff report writer and the live-switch gate. |
| `upload.ts` | Uploads one snapshot to R2, reads it back to prove it arrived, and switches `vehicles/live.json`. Dry run unless `--execute`. |
| `make_map.csv` | Hand-kept: which vPIC makes we keep (`include` yes/no) and the name visitors see (`display_name`). |
| `model_denylist.csv` | Hand-kept: model names we drop (trailers, chassis, kit cars…). |
| `snapshots/<id>/` | Each snapshot, committed: the served files plus `rows/` (full rows) and `diff-report.md`. |
| `.source-cache/<id>/` | The raw vPIC / EPA answers of a run (not committed, can be deleted). |

Inside `snapshots/<id>/`, exactly as they sit under `vehicles/<id>/` in R2:

- `makes.json`: every make, A→Z (the funnel's Make list).
- `makes/<make_id>.json`: one make's models (A→Z, each once) and its model years (newest first). One small file per make, so picking a make is one request.
- `manifest.json`: build time, source note, row counts, and a checksum of every served file.

Not served (for review and the next refresh): `rows/makes.json`, `rows/models.json`, `rows/model_years.json`, `diff-report.md`.

## The yearly refresh (each October, or on demand)

Claude prepares it, the owner approves it.

1. **Build** (about 40 minutes: about 11,000 lookups at 5 a second). From `api/`:

   ```
   npx tsx scripts/vehicles/ingest.ts --snapshot 2027-10-05
   ```

   Use the build date as the id. Each lookup is retried for about 4 minutes before the run stops. If it stops half way (for example the internet drops), run the same command again: answers already fetched are reused from `.source-cache/`.

2. **Read the diff report**: `snapshots/2027-10-05/diff-report.md`. It lists makes and models added and removed, rows per model year, and "review flags": new makes no one decided on, EPA names that match no vPIC make, odd model names. Fix `make_map.csv` or `model_denylist.csv` if needed, then rebuild without the network:

   ```
   npx tsx scripts/vehicles/ingest.ts --snapshot 2027-10-05 --offline
   ```

3. **Check it**:

   ```
   npx tsx scripts/vehicles/checks.ts 2027-10-05
   ```

   Every line must say PASS. It also runs the 2% guardrail against the newest older snapshot in `snapshots/`. Optional proofs: `--ac6` (a made-up copy missing 5% of rows is refused), and `--same-source-as <folder>` after an `--offline` rebuild into another folder with `--out` (AC5: same ids, empty diff).

4. **Commit** the snapshot folder, `make_map.csv` and `model_denylist.csv`, and review the diff report like code.

## Upload and go live (owner steps)

These touch the real bucket, so only the owner runs them. `upload.ts` reads the bucket name for the chosen env from `api/wrangler.toml` and uses the owner's own wrangler login (Cloudflare token in 1Password, `haikov-env-dev`).

**Important:** in `wrangler.toml` today, staging and production use the **same** R2 bucket (`kodigital-homepages-cms-media`). Uploading a snapshot is harmless (new files under a new folder). Switching live is not env-specific: `vehicles/live.json` is one file, so switching it "on staging" also switches production.

1. See what would happen (runs nothing):

   ```
   npx tsx scripts/vehicles/upload.ts --snapshot 2027-10-05 --env staging
   ```

2. Upload, read everything back, and print the data-totals table (script output vs. storage: makes, models, model-year rows, files, checksums):

   ```
   npx tsx scripts/vehicles/upload.ts --snapshot 2027-10-05 --env staging --execute
   ```

   It refuses to overwrite a snapshot id that is already uploaded with different content (snapshot files are cached for a year, so an id never changes; build a new id such as `2027-10-05-b`).

3. Switch live:

   ```
   npx tsx scripts/vehicles/upload.ts --snapshot 2027-10-05 --env staging --switch-live --execute
   ```

   It refuses, and leaves `vehicles/live.json` as it was, when a QA check fails, when the snapshot isn't fully uploaded, or when it would remove more than 2% of the live snapshot's (make, year, model) rows. In that last case, after reading the diff report, the owner can approve it with `--approve-diff`.

4. **Roll back**: switch live to the previous snapshot id the same way (its files are still there; keep old snapshots at least 30 days). Rolling back usually needs `--approve-diff`.

Nothing is purged: a new snapshot has new addresses.

## Local development

`--local` uses wrangler's local storage (what `wrangler dev` reads), never the real bucket:

```
npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --local --execute
npx tsx scripts/vehicles/upload.ts --snapshot 2026-11-23 --local --switch-live --execute
```

Add `--persist-to <folder>` to use a separate local storage folder.

## Rules the build follows (from the owner's spec)

- Models are looked up **by make ID only**, one vehicle type at a time (car, mpv, truck), never by make name and never without a type (V1–V4). vPIC and EPA are never called by the funnel or the Worker.
- Make names come from `make_map.csv`; a make with no row gets the title-case default and a flag (N1).
- Model names keep vPIC's casing, trimmed, with a powertrain bracket removed: "RAV4 Prime (PHEV)" becomes "RAV4 Prime" (N2). Other brackets are kept and flagged.
- `model_denylist.csv` terms drop any model containing them; pairs drop one model of one make (N3). The pairs keep out commercial trucks, bus and van chassis, fleet- or police-only models, robotaxis and models never sold in the US (owner decision, 23 Nov 2026). Every removed make + model, with its years, is listed in the diff report under "Removed by the drop list".
- `model_id` is `m_` + the first 10 hex characters of sha256 of `<make_id>:<model name in lower case>` (N4). Stored leads keep these ids forever, so **never change this formula**.
- The same model in the same year under several types is one row with `vehicle_types` like `mpv,truck`; duplicates that differ only in upper/lower case are merged.
- Nothing is made up: anything the sources don't confirm is a flag in the diff report.

## Keys

None for the data: vPIC and EPA are free and need no key. The scripts send a plain, generic client name. Uploading uses the owner's wrangler login.

## Tests

`api/test/vehicles-ingest.test.ts`, using saved real answers in `api/test/fixtures/vehicles/` (no live calls):

```
NODE_OPTIONS=--experimental-sqlite npx vitest run test/vehicles-ingest.test.ts
```
