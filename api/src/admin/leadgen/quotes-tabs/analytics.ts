// LeadGen admin UI — Quotes editor, ANALYTICS tab module (LEADGEN-REWORK-03
// §12 P3a mechanical split of ui-quotes.ts). The §15.6 read-only funnel
// analytics panel (hydrated after paint by the page's own script).
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).




// Analytics panel (§15.6 read-only) — filled after paint.
export function renderAnalyticsPanel(): string {
  return `<div class="lg-qpanel" data-panel="analytics">
  <div class="card">
    <h3>Funnel analytics (§15.6)</h3>
    <div class="table-wrapper">
      <table class="table" id="lg-analytics-table" aria-label="Funnel analytics">
        <thead><tr>
          <th scope="col">Funnel</th><th scope="col" class="lg-num">Visits</th><th scope="col" class="lg-num">Bounce</th>
          <th scope="col" class="lg-num">Completion</th><th scope="col" class="lg-num">CVR (clicks)</th>
          <th scope="col" class="lg-num">CVR (completed)</th><th scope="col" class="lg-num">Avg RPC</th>
          <th scope="col" class="lg-num">Avg RPS</th><th scope="col" class="lg-num">Unfilled</th><th scope="col" class="lg-num">Revenue</th>
        </tr></thead>
        <tbody id="lg-analytics-body"><tr><td colspan="10" class="form-help">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>`;
}
