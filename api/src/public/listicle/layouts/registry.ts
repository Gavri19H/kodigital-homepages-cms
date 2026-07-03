// Listicle layout registry — design contract §14, implemented verbatim.
//
// Articles render through a pluggable layout registry; the `default` layout
// reproduces the measured reference (docs/listicles/reference-layout-audit.md,
// DEV-13: the 2026-07-03 LIVE page is the reference) as scoped tokens, not
// hardcode. `layout_style_id` is per-Version; an unknown id falls back to the
// default layout (§14 "unknown id → default").

import { defaultLayout } from "./default/components";

// The §14 view-model the default layout's renderShell consumes: the per-
// Version chrome content (headline / byline / hero / intro) plus the already-
// rendered page slots. Param SHAPES are typed here (the contract's interface
// is pseudo-TS); the §14 member names + signatures are verbatim.
export interface ListicleShellVm {
  // Raw headline (per-Version). The default layout renders the MEASURED
  // two-line heading pattern: authored line breaks split into stacked
  // heading elements (drift register `headline`: two h2, w700 via <strong>).
  headline: string;
  bylineHtml: string;
  heroHtml: string;
  introHtml: string;
  pagesHtml: string;
}

// One Page slot as the layout sees it (§15.7 page layer identity attrs).
export interface ListiclePageVm {
  pageIndex: number;
  selectionMode: string;
  abTestId: string | null;
  ruleSetId: string | null;
  defaultCandidateId: string;
}

export interface ListicleLayout {
  id: string;
  name: string;
  cssVars: Record<string, string>;
  renderShell(vm: ListicleShellVm): string; // headline / intro / hero wrapper (per Version)
  renderPage(page: ListiclePageVm, chosenCandidateHtml: string): string;
  renderSection(sectionHtml: string): string;
}

export const LAYOUTS: Record<string, ListicleLayout> = { default: defaultLayout /* … */ };

export function getLayout(id: string): ListicleLayout {
  return LAYOUTS[id] ?? LAYOUTS["default"]!;
} // unknown id → default
