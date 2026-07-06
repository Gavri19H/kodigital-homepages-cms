# LeadGen — Traceability (filled during implementation)

Living record the implementation agent maintains. Mirrors `docs/listicles/traceability.md`.

## Migration numbering
The contract proposes `0036`–`0039`. Re-check `ls api/migrations/` at build time; if the head has advanced past `0035`, renumber to `head+1..head+4` and record the mapping here.

| Contract file | Shipped as | Applied (local) | Applied (remote) |
|---|---|---|---|
| `0036_leadgen_core.sql` | `____` | ☐ | ☐ |
| `0037_leadgen_analytics_mirror.sql` | `____` | ☐ | ☐ |
| `0038_leadgen_revenue_infra.sql` | `____` | ☐ | ☐ |
| `0039_leadgen_conversion_dedupe.sql` | `____` | ☐ | ☐ |

Each shipped migration MUST be anchored in `.github/workflows/deploy.yml`.

## Measured design-token overrides (OQ-2)
Record any provisional §14.2 token replaced by a measured value.

| Token group | Provisional | Measured | measuredAt |
|---|---|---|---|
| _(fill in)_ | | | |

## Deliverable traceability
Copy the §35.3 table here and tick each row when its code + tests are green.

## Open-question resolutions
Record how each §34 OQ was resolved (OQ-1 screenshot reconciliation, OQ-3 CH ingest split, OQ-4 serif license, OQ-6 Maps key strategy, OQ-7 bp vs %, OQ-8 cap concurrency, OQ-9 migration renumber, OQ-10 preview isolation).
