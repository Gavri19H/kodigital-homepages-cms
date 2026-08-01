export type ShellState = "loading" | "empty" | "dependency_unavailable" | "error";
export type SectionKey = "flows" | "connections" | "activity" | "controls" | "reports";

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string; href: string }> = [
  { key: "flows", label: "Flows", href: "/admin/conversions/flows" },
  { key: "connections", label: "Connections", href: "/admin/conversions/connections" },
  { key: "activity", label: "Activity", href: "/admin/conversions/activity" },
  { key: "controls", label: "Controls", href: "/admin/conversions/controls" },
  { key: "reports", label: "Reports", href: "/admin/reporting" },
];

const SHELL_STATES: Record<ShellState, { title: string; detail: string; tone: string }> = {
  loading: {
    title: "Loading",
    detail: "Loading Conversions and Reporting.",
    tone: "neutral",
  },
  empty: {
    title: "Nothing here yet",
    detail: "No conversion resources are available for this section.",
    tone: "neutral",
  },
  dependency_unavailable: {
    title: "Dependency unavailable",
    detail: "Conversions Core is unavailable. No actions are available until it recovers.",
    tone: "warning",
  },
  error: {
    title: "Unable to load safely",
    detail: "The shell could not load. Try again after its dependencies recover.",
    tone: "error",
  },
};

export function readShellSection(value: string | undefined): SectionKey {
  return SECTIONS.some((section) => section.key === value) ? (value as SectionKey) : "flows";
}

export function readShellState(value: string | undefined): ShellState {
  return value === "loading" || value === "empty" || value === "error"
    ? value
    : "dependency_unavailable";
}

export function ShellApp(props: {
  section: SectionKey;
  state: ShellState;
  bootstrapActive: boolean;
}) {
  const selected = SECTIONS.find((section) => section.key === props.section) ?? SECTIONS[0]!;
  const state = SHELL_STATES[props.state];
  return (
    <section class="ko-conversions-shell" aria-labelledby="ko-conversions-section-title">
      <div
        class="ko-conversions-bootstrap-warning"
        data-bootstrap-warning
        role="alert"
        hidden={!props.bootstrapActive}
      >
        Temporary capability bootstrap: production side effects remain unavailable.
      </div>
      <nav class="ko-conversions-nav" aria-label="Conversions and reporting">
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.key}>
              <a href={section.href} aria-current={section.key === selected.key ? "page" : undefined}>
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div class="ko-conversions-panel">
        <div class="ko-conversions-panel-heading">
          <div>
            <p class="ko-conversions-eyebrow">Conversions &amp; Reporting</p>
            <h2 id="ko-conversions-section-title">{selected.label}</h2>
          </div>
          <span class="ko-conversions-local-badge">{props.bootstrapActive ? "Temporary access" : "Admin"}</span>
        </div>
        <div
          class={`ko-conversions-state ko-conversions-state--${state.tone}`}
          role={props.state === "error" ? "alert" : "status"}
          aria-live="polite"
          aria-busy={props.state === "loading" ? "true" : "false"}
        >
          <h3>{state.title}</h3>
          <p>{state.detail}</p>
        </div>
      </div>
      <div class="ko-conversions-sr-only" data-conversions-status-live aria-live="polite">
        {props.bootstrapActive
          ? "A temporary capability bootstrap status was supplied by the signer."
          : "Capability bootstrap is not active."}
      </div>
    </section>
  );
}

export function ShellFrame(props: {
  section: SectionKey;
  bootstrapActive: boolean;
  children: ComponentChildren;
}) {
  const selected = SECTIONS.find((section) => section.key === props.section) ?? SECTIONS[0]!;
  return (
    <section class="ko-conversions-shell" aria-labelledby="ko-conversions-section-title">
      <div
        class="ko-conversions-bootstrap-warning"
        data-bootstrap-warning
        role="alert"
        hidden={!props.bootstrapActive}
      >
        Temporary capability bootstrap: production side effects remain unavailable.
      </div>
      <nav class="ko-conversions-nav" aria-label="Conversions and reporting">
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.key}>
              <a href={section.href} aria-current={section.key === selected.key ? "page" : undefined}>
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div class="ko-conversions-panel">
        <div class="ko-conversions-panel-heading">
          <div>
            <p class="ko-conversions-eyebrow">Conversions &amp; Reporting</p>
            <h2 id="ko-conversions-section-title">{selected.label}</h2>
          </div>
          <span class="ko-conversions-local-badge">{props.bootstrapActive ? "Temporary access" : "Admin"}</span>
        </div>
        {props.children}
      </div>
      <div class="ko-conversions-sr-only" data-conversions-status-live aria-live="polite">
        {props.bootstrapActive
          ? "A temporary capability bootstrap status was supplied by the signer."
          : "Capability bootstrap is not active."}
      </div>
    </section>
  );
}
import type { ComponentChildren } from "preact";
