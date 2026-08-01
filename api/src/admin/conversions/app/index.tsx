import { render } from "preact";
import { ProductApp } from "./product";
import { readShellSection } from "./shell";
import "./styles.css";

export {
  buildConnectionCreateBody,
  unwrapCoreControls,
  unwrapCorePage,
  unwrapCoreResult,
  unwrapConversionsUiContext,
  unwrapCreatedConnectionOrFlow,
} from "./product-state";

const root = typeof document === "undefined" ? null : document.getElementById("ko-conversions-root");
if (typeof HTMLElement !== "undefined" && root instanceof HTMLElement) {
  render(
    <ProductApp
      section={readShellSection(root.dataset.page) === "reports" ? "flows" : readShellSection(root.dataset.page)}
      bootstrapActive={root.dataset.bootstrapActive === "true"}
    />,
    root,
  );
}
