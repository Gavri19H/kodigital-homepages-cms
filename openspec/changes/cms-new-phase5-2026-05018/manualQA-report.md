# ManualQA Report

**Change ID:** cms-new-phase5-2026-05018
**Batch ID:** MQA-BATCH-1-CI-ARTIFACT
**Executor Model:** deterministic_ci_artifact_route
**Batch Size:** 1
**Evidence Path:** evidence/evidence.jsonl
**Payload Capture:** not_applicable
**Interactive Elements Tested:** False
**Revert Plan:** Revert merge commit 6d9b918 via: gh pr revert 19 or git revert -m 1 6d9b918
**Revert Executed:** False
**Generated:** 2026-05-20T21:14:40.048500Z

## Overall Verdict

**PASS** — 1 PASS, 0 FAIL, 0 BLOCKED, 0 INCONCLUSIVE

## Blockers/Warnings


## Scenario MQA-1

**Status:** PASS
**Classification:** READ_ONLY
**Why:** All 22 PRD stories verified by deterministic CI artifacts on merge commit 6d9b918: typecheck exits 0; 429/429 vitest tests pass (66 prior + 12 new from main merge); verify:no-legacy-prod-refs / verify:infra / verify:worker-config all exit 0. Develop verdict PASS 59/59 RC pre-merge. Server-rendered HTML mission with no interactive UI: browser QA would give zero marginal evidence beyond the deterministic test bindings already enumerated in test_contract.json (every PRD AC maps to a grep / test_name_regex / test_exit_code AC1). manualQA.md authored no browser scenarios — the test_contract bindings are the source of truth.
**Story:** T1-T22
**Action:** Aggregate verification of CI artifacts for merge commit 6d9b918 against PRD.json (22 stories) + verdict_output.json (59 RC).
**Expected:** All 22 stories pass CI (typecheck + vitest + 3 verify scripts) AND 59/59 required claims satisfied by deterministic backing in evidence/evidence.jsonl.
**Actual:** CI run 26189968357 on merged main: typecheck PASS, 429 tests PASS, 3 verify scripts PASS. Develop verdict_output.json: PASS, 59 required_claims_passed, 0 failed.
  - Artifact: .a2z/mission-state/cms-new-phase5-2026-05018/ci_deploy_log.jsonl
  - Artifact: .a2z/mission-state/cms-new-phase5-2026-05018/evidence/verdict_output.json

## Self-Roast

Adversarial self-check against the deterministic_ci_artifact verdict.

Q1: If deterministic_ci_artifact's PASS rests on 429/429 tests + 3 verify scripts + 59/59 required claims, could the contract be silently violated while the tests still report green?

A1: Not for the authored AC surface. Every PRD acceptance criterion is enumerated 1:1 in test_contract.json (grep_count or test_exit_code binding). Develop's truth machine already PASS-verified 59 of 59 required claims on those bindings with deterministic_parser backing in evidence.jsonl. CI re-ran the same bindings on the merge HEAD (6d9b918). A silent disable would have lit up evidence_validate.py and refused the develop terminal. The legitimate residual risk is runtime/render correctness on the deployed tenant content domain — covered separately by the deferred production smoke obligation (production_deploy_status = PENDING_USER_WORKFLOW_DISPATCH).

Q2: Story T16 says cms.kodigital.app GET / -> 404 with no leak — is that verified at PRODUCTION, or only at unit-test level?

A2: Verified at UNIT-TEST level only. T16 is implemented as test/public-admin-host-no-home.test.ts (vitest with Miniflare) and proves the worker returns 404 for Host=cms.kodigital.app on the squash-merged HEAD before any deploy. PRODUCTION verification would require the operator to trigger gh workflow run deploy.yml AND a curl with Host header — but the route is Cloudflare Access protected, so anonymous curl redirects to login instead of hitting the worker. The clean production smoke would query a tenant content domain configured to route through the worker and expect 200 plus site-header in the body.

Q3: manualQA.md authored ZERO browser scenarios — does that mean the plan was bad, or that browser QA is genuinely not the right modality for this mission?

A3: The latter. The mission's deliverable is server-side HTML rendering with a deterministic test contract; test_contract.json maps every AC to a grep, test_exit_code, or test_name_regex binding. vitest tests render the templates with Miniflare and assert markup in-process, which is structurally stronger than browser smoke for THIS scope (server templates with no interactive client behavior beyond passive listeners and share/copy). The plan correctly omitted browser scenarios; the test_contract bindings are the full evidence surface. If a future story adds an interactive UI that POSTs to the worker, browser scenarios become necessary then.

Q4: T18 forbids hardcoded TheIWise brand in rendered Home and Article — can a banned token slip through the regex but render in HTML?

A4: The banned tokens are tested via test/public-no-theiwise-brand-render.test.ts which renders the actual templates and asserts the rendered HTML body does not contain the banned strings; the test concatenates the banned tokens at runtime to avoid SR2-style banned-source-code matches. Develop verdict shows RC for T18 PASS with deterministic backing on the template render output. Residual risk: a banned token reachable only through site-provided brandTokens content (user data) — but T18 is scoped to template-side brand strings, not user-content moderation.

Q5: T20 image lazy-load and T21 ad-slot attributes — can a template skip the attributes in a code path the unit test doesn't traverse?

A5: Both stories' tests render through the same renderHome and renderArticle entry points used in production, and the AC assertions iterate over EVERY img and EVERY ad-slot in the rendered output. test/public-image-attrs.test.ts asserts alt+width+height on every img and loading=lazy on every below-fold image; test/public-ad-slots.test.ts asserts data-ad-slot + data-ad-type in the leaderboard/in-feed/rect set. A code path that skips attributes would have to bypass renderHome/renderArticle entirely, which would surface as a different RC failure (T10/T11 render checks).

## QA Review Verdict

**reviewer_model:** deterministic_ci_artifact_route

**Verdict:** PASS (all checks passed)
