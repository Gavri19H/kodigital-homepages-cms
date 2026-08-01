import { render } from "preact";
import { ReportingProduct } from "./product";
import "../../conversions/app/styles.css";

export {
  parseExplicitAccountIds,
  unwrapCorePage,
  unwrapCoreResultCollection,
  unwrapCoreResult,
  unwrapCreatedReport,
  unwrapReportQueryRows,
  withReportAccountIds,
} from "../../conversions/app/product-state";

const root = typeof document === "undefined" ? null : document.getElementById("ko-reporting-root");
if (typeof HTMLElement !== "undefined" && root instanceof HTMLElement) {
  render(
    <ReportingProduct bootstrapActive={root.dataset.bootstrapActive === "true"} />,
    root,
  );
}
