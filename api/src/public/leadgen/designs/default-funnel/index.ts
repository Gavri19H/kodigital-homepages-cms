// Barrel for the default funnel visual design (contract 05 §14.1). Keeps
// consumer imports to a single path: the MEASURED token contract (tokens.ts)
// + its scoped chrome-CSS generator (styles.ts). No logic of its own.

export { defaultFunnelDesign } from "./tokens";
export type { DefaultFunnelDesign } from "./tokens";
export {
  funnelChromeCss,
  DEFAULT_FUNNEL_SCOPE,
  FUNNEL_DESIGN_SCOPE_ATTR,
} from "./styles";
