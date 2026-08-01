import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ShellFrame } from "../../conversions/app/shell";
import { ConversionsApiError, requestConversionsApi } from "../../conversions/app/api-client";
import {
  CoreWireError,
  isRecord,
  unwrapConversionsUiContext,
  unwrapCorePage,
  unwrapCoreResult,
  unwrapCoreResultCollection,
  unwrapExportStatus,
  unwrapCalculatedReportQueryRows,
  unwrapReportAdvancedResult,
  unwrapReportDrillResult,
  unwrapReportComparisonRows,
  type ReportAdvancedResult,
  type ReportComparisonRows,
  type ReportDrillResult,
} from "../../conversions/app/product-state";
import {
  fieldFor,
  REPORT_FIELDS,
  REPORT_TEMPLATES,
  type Dataset,
  type Operator,
  type ReportField,
} from "./catalog";

type Item = Record<string, unknown>;
type DisplayMode = "table" | "pivot" | "line" | "area" | "bar" | "stacked_bar" | "pie_donut" | "kpi";
type Filter = { readonly field_id: string; readonly operator: Operator; readonly value?: string };
type CalculationOperator = "add" | "subtract" | "multiply" | "divide";
type CalculationOperand = {
  readonly kind: "measure" | "constant";
  readonly value: string;
};
type CalculationStep = {
  readonly operator: CalculationOperator;
  readonly operand: CalculationOperand;
};
type CalculatedMeasure = {
  readonly id: string;
  readonly label: string;
  readonly firstMeasureId: string;
  readonly steps: ReadonlyArray<CalculationStep>;
};
type Comparison = "prior_period" | "year_over_year";
type Tab = "library" | "builder" | "results" | "delivery";

const DISPLAY_LABELS: ReadonlyArray<readonly [DisplayMode, string]> = [
  ["table", "Table"],
  ["pivot", "Pivot"],
  ["line", "Line chart"],
  ["area", "Area chart"],
  ["bar", "Bar chart"],
  ["stacked_bar", "Stacked bar"],
  ["pie_donut", "Pie / donut"],
  ["kpi", "KPI cards"],
];

const OPERATOR_LABELS: Readonly<Record<Operator, string>> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  is_empty: "is empty",
  before: "is before",
  on_or_after: "is on or after",
  greater_than: "is greater than",
  less_than: "is less than",
};

function message(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message : "Reporting could not complete the action. Try again.";
}

function text(item: Item, key: string, fallback = "—"): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value) : fallback;
}

function reportId(item: Item): string {
  return typeof item.report_id === "string" ? item.report_id : "";
}

function today(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function calculatedId(label: string, index: number): string {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `calculated.${/^[a-z]/.test(normalized) ? normalized.slice(0, 54) : `metric_${index + 1}`}`;
}

function calculatedExpression(definition: CalculatedMeasure): Item {
  return definition.steps.reduce<Item>((left, step) => ({
    kind: "binary",
    operator: step.operator,
    left,
    right: step.operand.kind === "measure"
      ? { kind: "measure", field_id: step.operand.value }
      : { kind: "constant", value: step.operand.value },
  }), { kind: "measure", field_id: definition.firstMeasureId });
}

function defaultSelection(dataset: Dataset): { dimensions: ReadonlyArray<string>; measures: ReadonlyArray<string> } {
  if (dataset === "conversions") return {
    dimensions: ["dimension.day"],
    measures: ["measure.qualified_count", "measure.attributed_count"],
  };
  if (dataset === "deliveries") return {
    dimensions: ["dimension.day"],
    measures: ["measure.delivery_attempts", "measure.delivery_successes"],
  };
  return {
    dimensions: ["dimension.day"],
    measures: ["measure.run_runs", "measure.run_records_seen"],
  };
}

function displayReason(
  mode: DisplayMode,
  dataset: Dataset,
  dimensions: ReadonlyArray<string>,
  measures: ReadonlyArray<string>,
  filters: ReadonlyArray<Filter>,
): string | null {
  const fields = measures.map((id) => fieldFor(dataset, id)).filter(Boolean) as ReportField[];
  const money = fields.some((field) => field.requiredDimension !== undefined);
  const additive = fields.every((field) => field.additive !== false);
  if (mode === "table") return null;
  if (mode === "pivot") return dimensions.length < 1 ? "Pivot needs at least one grouping." : null;
  if (mode === "kpi") {
    if (dimensions.length > 0) return "KPI cards cannot have a grouping.";
    if (measures.length < 1 || measures.length > 4) return "KPI cards need one to four measures.";
    return null;
  }
  if (mode === "line" || mode === "area") {
    if (!dimensions.includes("dimension.day")) return "Line and area charts require Date.";
    const context = dimensions.filter((id) => id !== "dimension.day"
      && filters.some((filter) => filter.field_id === id && filter.operator === "equals"));
    const series = dimensions.filter((id) => id !== "dimension.day" && !context.includes(id));
    if (series.length > 1) return "Use Date, at most one series grouping, and equality-filtered context groupings.";
    if (fields.some((field) => field.requiredDimension
      && !context.includes(field.requiredDimension))) {
      return "Currency charts require the currency grouping to have one exact “is” filter.";
    }
    if (measures.length !== 1 && !(measures.length === 2 && fields.some((field) => field.id === "measure.fx_missing_count"))) {
      return "Line and area charts use one value measure plus its required FX-quality measure.";
    }
    return null;
  }
  if (mode === "bar") {
    if (dimensions.length < 1) return "Bar charts need one category.";
    const context = dimensions.slice(1).filter((id) => filters.some(
      (filter) => filter.field_id === id && filter.operator === "equals",
    ));
    const series = dimensions.slice(1).filter((id) => !context.includes(id));
    if (series.length > 1) return "Use one category, at most one series grouping, and equality-filtered context groupings.";
    if (fields.some((field) => field.requiredDimension
      && !context.includes(field.requiredDimension))) {
      return "Currency charts require the currency grouping to have one exact “is” filter.";
    }
    if (measures.length !== 1 && !(measures.length === 2 && fields.some((field) => field.id === "measure.fx_missing_count"))) {
      return "Bar charts use one value measure plus its required FX-quality measure.";
    }
    return null;
  }
  if (mode === "stacked_bar") {
    if (dimensions.length !== 2) return "Stacked bars need exactly a category and stack grouping.";
    if (measures.length !== 1 || !additive || money) return "Stacked bars require one additive non-currency measure.";
    return null;
  }
  if (dimensions.length !== 1) return "Pie/donut needs exactly one slice grouping.";
  if (measures.length !== 1 || !additive || money) return "Pie/donut requires one additive non-currency measure.";
  return null;
}

function displayConfig(
  mode: DisplayMode,
  dimensions: ReadonlyArray<string>,
  measures: ReadonlyArray<string>,
  filters: ReadonlyArray<Filter>,
  pivotRowIds: ReadonlyArray<string>,
): Item {
  if (mode === "table") return { column_field_ids: [...dimensions, ...measures] };
  if (mode === "pivot") return {
    row_dimension_ids: dimensions.filter((id) => pivotRowIds.includes(id)),
    column_dimension_ids: dimensions.filter((id) => !pivotRowIds.includes(id)),
    value_measure_ids: measures,
  };
  if (mode === "kpi") return { measure_field_ids: measures };
  if (mode === "stacked_bar") return {
    category_dimension_id: dimensions[0],
    stack_dimension_id: dimensions[1],
    context_dimension_ids: [],
    value_measure_id: measures[0],
  };
  if (mode === "pie_donut") return {
    variant: "donut",
    slice_dimension_id: dimensions[0],
    context_dimension_ids: [],
    value_measure_id: measures[0],
  };
  const primary = mode === "bar" ? "category_dimension_id" : "x_dimension_id";
  const primaryDimension = mode === "bar" ? dimensions[0] : "dimension.day";
  const remaining = dimensions.filter((id) => id !== primaryDimension);
  const context = remaining.filter((id) => filters.some(
    (filter) => filter.field_id === id && filter.operator === "equals",
  ));
  return {
    [primary]: primaryDimension,
    series_dimension_id: remaining.find((id) => !context.includes(id)) ?? null,
    context_dimension_ids: context,
    value_measure_id: measures.find((id) => id !== "measure.fx_missing_count"),
    quality_measure_ids: measures.filter((id) => id === "measure.fx_missing_count"),
  };
}

type CalculationDomain = "scalar" | "count" | "source_money" | "reporting_money";

function calculationDomain(field: ReportField | undefined): CalculationDomain | null {
  if (!field) return null;
  if (field.additive === false) return "scalar";
  if (field.requiredDimension === "dimension.source_currency") return "source_money";
  if (field.requiredDimension === "dimension.reporting_currency") return "reporting_money";
  return "count";
}

function calculationReason(dataset: Dataset, definition: CalculatedMeasure): string | null {
  let left = calculationDomain(fieldFor(dataset, definition.firstMeasureId));
  if (!left || definition.steps.length < 1) return "Choose a valid first measure and at least one operation.";
  if (definition.steps.length > 16) return "A calculated measure can contain at most 16 operations.";
  for (const step of definition.steps) {
    const right = step.operand.kind === "constant"
      ? "scalar" : calculationDomain(fieldFor(dataset, step.operand.value));
    if (!right) return "Choose a valid numeric measure for every operation.";
    if (step.operand.kind === "constant"
      && !/^-?(0|[1-9][0-9]{0,13})\.[0-9]{4}$/.test(step.operand.value)) {
      return "Every number must use four decimal places.";
    }
    if (step.operator === "divide" && step.operand.kind === "constant"
      && step.operand.value === "0.0000") return "Division by a fixed zero is not valid.";
    if ((step.operator === "add" || step.operator === "subtract") && left !== right) {
      return "Addition and subtraction require matching units.";
    }
    if (step.operator === "multiply" && left !== "scalar" && right !== "scalar") {
      return "Multiplication requires one side to be a unitless number or ratio.";
    }
    if (step.operator === "divide" && left === "scalar" && right !== "scalar") {
      return "A unitless number cannot be divided by a measured value.";
    }
    if (step.operator === "divide" && left !== right && right !== "scalar") {
      return "Division requires matching units or a unitless divisor.";
    }
    if (step.operator === "add" || step.operator === "subtract") {
      // Matching domains preserve the unit.
    } else if (step.operator === "multiply") {
      left = left === "scalar" ? right : left;
    } else {
      left = left === right ? "scalar" : left;
    }
  }
  return null;
}

function operationLabel(operator: CalculationOperator): string {
  return operator === "add" ? "plus"
    : operator === "subtract" ? "minus"
      : operator === "multiply" ? "times"
        : "divided by";
}

function calculationSentence(dataset: Dataset, definition: CalculatedMeasure): string {
  return definition.steps.reduce(
    (sentence, step) => `(${sentence} ${operationLabel(step.operator)} ${
      step.operand.kind === "measure"
        ? fieldFor(dataset, step.operand.value)?.label ?? step.operand.value
        : step.operand.value
    })`,
    fieldFor(dataset, definition.firstMeasureId)?.label ?? definition.firstMeasureId,
  );
}

function exportResource(value: Item | null): Item | null {
  if (!value) return null;
  return isRecord(value.export) ? value.export : value;
}

function recurrenceSentence(value: unknown): string {
  if (!isRecord(value)) return "Recurrence unavailable";
  const timezone = typeof value.timezone === "string" ? value.timezone : "stored timezone";
  if (value.type === "interval" && Number.isSafeInteger(value.interval_minutes)) {
    return `Every ${value.interval_minutes} minutes in ${timezone}`;
  }
  if (value.type === "daily" && typeof value.local_time === "string") {
    return `Daily at ${value.local_time} in ${timezone}`;
  }
  if (value.type === "weekly" && typeof value.local_time === "string"
      && Array.isArray(value.weekdays)) {
    return `Weekly on day ${value.weekdays.join(", ")} at ${value.local_time} in ${timezone}`;
  }
  if (value.type === "monthly" && typeof value.local_time === "string"
      && Number.isSafeInteger(value.day_of_month)) {
    return `Monthly on day ${value.day_of_month} at ${value.local_time} in ${timezone}`;
  }
  return `Stored recurrence in ${timezone}`;
}

function FieldPicker(props: {
  title: string;
  fields: ReadonlyArray<ReportField>;
  selected: ReadonlyArray<string>;
  onToggle: (field: ReportField, checked: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = props.fields.filter((field) => `${field.label} ${field.help}`.toLowerCase().includes(search.toLowerCase()));
  return <fieldset class="ko-report-field-picker"><legend>{props.title}</legend>
    <label class="ko-filter"><span>Search {props.title.toLowerCase()}</span><input type="search" value={search} onInput={(event) => setSearch(event.currentTarget.value)} /></label>
    <div>{visible.map((field) => <label class="ko-report-field">
      <input type="checkbox" checked={props.selected.includes(field.id)} onChange={(event) => props.onToggle(field, event.currentTarget.checked)} />
      <span><strong>{field.label}</strong><small>{field.help}</small></span>
    </label>)}</div>
  </fieldset>;
}

function ResultVisual(props: {
  rows: ReadonlyArray<Item>;
  mode: DisplayMode;
  fields: ReadonlyArray<string>;
  dataset: Dataset;
  pivotRowIds?: ReadonlyArray<string>;
  comparisons?: ReadonlyArray<ReportComparisonRows>;
}) {
  if (props.rows.length === 0) return <div class="ko-conversions-state"><h3>No matching rows</h3><p>Change the date range or filters and run again.</p></div>;
  if (props.mode === "pivot") {
    const dimensionIds = props.fields.filter((fieldId) => fieldId.startsWith("dimension."));
    const measureIds = props.fields.filter((fieldId) => fieldId.startsWith("measure.") || fieldId.startsWith("calculated."));
    const requestedRows = props.pivotRowIds ?? [];
    const rowIds = dimensionIds.filter((fieldId) => requestedRows.includes(fieldId));
    const effectiveRowIds = rowIds.length > 0 ? rowIds : dimensionIds.slice(0, 1);
    const columnIds = dimensionIds.filter((fieldId) => !effectiveRowIds.includes(fieldId));
    const valueTuple = (row: Item, ids: ReadonlyArray<string>) => ids.map((fieldId) => (
      row[fieldId] === null || row[fieldId] === undefined ? "Not available" : String(row[fieldId])
    ));
    const columnTuples = new Map<string, ReadonlyArray<string>>();
    const pivotRows = new Map<string, {
      readonly values: ReadonlyArray<string>;
      readonly cells: Map<string, unknown>;
    }>();
    for (const row of props.rows) {
      const columnValues = valueTuple(row, columnIds);
      const columnKey = JSON.stringify(columnValues);
      columnTuples.set(columnKey, columnValues);
      const rowValues = valueTuple(row, effectiveRowIds);
      const rowKey = JSON.stringify(rowValues);
      const target = pivotRows.get(rowKey) ?? { values: rowValues, cells: new Map<string, unknown>() };
      for (const measureId of measureIds) {
        const cellKey = JSON.stringify([columnKey, measureId]);
        target.cells.set(cellKey, target.cells.has(cellKey) ? "Duplicate grouping" : row[measureId]);
      }
      pivotRows.set(rowKey, target);
    }
    const columns = [...columnTuples.entries()];
    return <div class="ko-table-scroll"><table class="ko-resource-table">
      <caption>Pivot preview from exact server-grouped rows</caption>
      <thead><tr>
        {effectiveRowIds.map((fieldId) => <th scope="col">{fieldFor(props.dataset, fieldId)?.label ?? fieldId}</th>)}
        {columns.flatMap(([columnKey, values]) => measureIds.map((measureId) => <th scope="col">
          {[...values, fieldFor(props.dataset, measureId)?.label ?? measureId].filter(Boolean).join(" · ")}
        </th>))}
      </tr></thead>
      <tbody>{[...pivotRows.values()].map((pivotRow) => <tr>
        {pivotRow.values.map((value) => <th scope="row">{value}</th>)}
        {columns.flatMap(([columnKey]) => measureIds.map((measureId) => {
          const value = pivotRow.cells.get(JSON.stringify([columnKey, measureId]));
          return <td>{value === null || value === undefined ? "Not available" : String(value)}</td>;
        }))}
      </tr>)}</tbody>
    </table><p class="ko-muted">Rows, columns, and measure order follow the saved stable field IDs. This preview does not recompute totals in the browser.</p></div>;
  }
  const numericKey = props.fields.find((key) => key.startsWith("measure.") || key.startsWith("calculated."))
    ?? Object.keys(props.rows[0]).find((key) => Number.isFinite(Number(props.rows[0][key])));
  const labelKey = props.fields.find((key) => key.startsWith("dimension.")) ?? Object.keys(props.rows[0])[0];
  if (props.mode === "kpi") return <div class="ko-kpi-grid">{props.fields.filter((key) => key.startsWith("measure.") || key.startsWith("calculated.")).slice(0, 4).map((key) => {
    const current = Number(props.rows[0][key]);
    const comparison = props.comparisons?.[0]?.rows[0]?.[key];
    const prior = Number(comparison);
    const trend = Number.isFinite(current) && Number.isFinite(prior)
      ? current > prior ? "Up" : current < prior ? "Down" : "No change" : "Comparison unavailable";
    return <article><strong>{key.replace(/^(measure|calculated)\./, "").replaceAll("_", " ")}</strong><output>{String(props.rows[0][key] ?? "Not available")}</output>
      {comparison !== undefined && <small>{props.comparisons?.[0].kind === "prior_period" ? "Previous period" : "Last year"}: {String(comparison)} · {trend}</small>}</article>;
  })}</div>;
  if (["line", "area", "bar", "stacked_bar", "pie_donut"].includes(props.mode) && numericKey && labelKey) {
    const chartRows = props.rows.slice(0, 50);
    const values = chartRows.map((row) => Math.max(0, Number(row[numericKey]) || 0));
    const maximum = Math.max(1, ...values);
    const points = chartRows.map((row, index) => {
      const x = chartRows.length === 1 ? 50 : (index / (chartRows.length - 1)) * 96 + 2;
      const y = 96 - (Math.max(0, Number(row[numericKey]) || 0) / maximum) * 90;
      return `${x},${y}`;
    }).join(" ");
    const title = `${props.mode.replaceAll("_", " ")} of ${numericKey.replace(/^(measure|calculated)\./, "").replaceAll("_", " ")}`;
    if (props.mode === "bar") {
      const width = Math.max(0.8, 90 / Math.max(1, chartRows.length));
      return <figure class="ko-report-chart"><svg viewBox="0 0 100 100" role="img" aria-labelledby="ko-chart-title ko-chart-description">
        <title id="ko-chart-title">{title}</title><desc id="ko-chart-description">{chartRows.length} bars. Exact values and labels are in the table.</desc>
        {values.map((value, index) => { const height = (value / maximum) * 90; return <rect x={5 + index * (90 / chartRows.length)} y={96 - height} width={width} height={height} fill="rgb(37 99 235)"><title>{String(chartRows[index][labelKey])}: {value}</title></rect>; })}
      </svg><figcaption>Bar preview from the exact query rows; the accessible table is authoritative.</figcaption></figure>;
    }
    if (props.mode === "pie_donut") {
      const total = values.reduce((sum, value) => sum + value, 0);
      let offset = 0;
      const colors = ["#2563eb", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626"];
      return <figure class="ko-report-chart"><svg viewBox="0 0 100 100" role="img" aria-labelledby="ko-chart-title ko-chart-description">
        <title id="ko-chart-title">{title}</title><desc id="ko-chart-description">{chartRows.length} slices. Exact values and labels are in the table.</desc>
        {total > 0 && values.map((value, index) => {
          const length = value / total * 100;
          const currentOffset = offset;
          offset += length;
          return <circle cx="50" cy="50" r="32" fill="none" stroke={colors[index % colors.length]} stroke-width="22" pathLength="100" stroke-dasharray={`${length} ${100 - length}`} stroke-dashoffset={-currentOffset} transform="rotate(-90 50 50)"><title>{String(chartRows[index][labelKey])}: {value}</title></circle>;
        })}
      </svg><figcaption>Donut preview uses query values only for visual geometry; the accessible table is authoritative.</figcaption></figure>;
    }
    if (props.mode === "stacked_bar") {
      const categoryKey = props.fields.find((key) => key.startsWith("dimension."));
      const categories = new Map<string, number[]>();
      chartRows.forEach((row, index) => {
        const key = String(categoryKey ? row[categoryKey] : index);
        const current = categories.get(key) ?? [];
        current.push(values[index]);
        categories.set(key, current);
      });
      const totals = [...categories.values()].map((items) => items.reduce((sum, value) => sum + value, 0));
      const stackMaximum = Math.max(1, ...totals);
      const colors = ["#2563eb", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626"];
      return <figure class="ko-report-chart"><svg viewBox="0 0 100 100" role="img" aria-labelledby="ko-chart-title ko-chart-description">
        <title id="ko-chart-title">{title}</title><desc id="ko-chart-description">{categories.size} stacked categories. Exact segment values are in the table.</desc>
        {[...categories.entries()].flatMap(([category, items], categoryIndex) => {
          let used = 0;
          return items.map((value, stackIndex) => {
            const height = value / stackMaximum * 90;
            used += height;
            return <rect x={5 + categoryIndex * (90 / categories.size)} y={96 - used} width={Math.max(1, 82 / categories.size)} height={height} fill={colors[stackIndex % colors.length]}><title>{category}: {value}</title></rect>;
          });
        })}
      </svg><figcaption>Stacked-bar geometry follows exact server rows; the accessible table is authoritative.</figcaption></figure>;
    }
    return <figure class="ko-report-chart">
      <svg viewBox="0 0 100 100" role="img" aria-labelledby="ko-chart-title ko-chart-description">
        <title id="ko-chart-title">{title}</title>
        <desc id="ko-chart-description">{props.rows.length} query rows. The exact values remain in the table below.</desc>
        {props.mode === "area" && <polygon points={`2,96 ${points} 98,96`} fill="rgb(191 219 254)" />}
        <polyline points={points} fill="none" stroke="rgb(37 99 235)" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
      <figcaption>Visual preview. Exact query values are in the accessible table and are never replaced by browser-derived business totals.</figcaption>
    </figure>;
  }
  return null;
}

export function ReportingProduct(props: { bootstrapActive: boolean }) {
  const [tab, setTab] = useState<Tab>("library");
  const [reports, setReports] = useState<ReadonlyArray<Item>>([]);
  const [recipients, setRecipients] = useState<ReadonlyArray<Item>>([]);
  const [schedules, setSchedules] = useState<ReadonlyArray<Item>>([]);
  const [context, setContext] = useState<ReturnType<typeof unwrapConversionsUiContext> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedReport, setSelectedReport] = useState<Item | null>(null);

  const [name, setName] = useState("Conversions overview");
  const [description, setDescription] = useState("Daily conversion performance.");
  const [dataset, setDataset] = useState<Dataset>("conversions");
  const initial = defaultSelection("conversions");
  const [dimensions, setDimensions] = useState<ReadonlyArray<string>>(initial.dimensions);
  const [measures, setMeasures] = useState<ReadonlyArray<string>>(initial.measures);
  const [filters, setFilters] = useState<ReadonlyArray<Filter>>([]);
  const [sortField, setSortField] = useState("dimension.day");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("table");
  const [pivotRowIds, setPivotRowIds] = useState<ReadonlyArray<string>>(initial.dimensions.slice(0, 1));
  const [totals, setTotals] = useState(true);
  const [topN, setTopN] = useState(100);
  const [subtotals, setSubtotals] = useState(false);
  const [comparisons, setComparisons] = useState<ReadonlyArray<Comparison>>([]);
  const [drillThrough, setDrillThrough] = useState(false);
  const [calculatedMeasures, setCalculatedMeasures] = useState<ReadonlyArray<CalculatedMeasure>>([]);
  const [startDate, setStartDate] = useState(today(-30));
  const [endDate, setEndDate] = useState(today(1));
  const [reportTimezone, setReportTimezone] = useState("UTC");
  const [results, setResults] = useState<ReadonlyArray<Item>>([]);
  const [comparisonResults, setComparisonResults] = useState<ReadonlyArray<ReportComparisonRows>>([]);
  const [advancedResult, setAdvancedResult] = useState<ReportAdvancedResult | null>(null);
  const [drillResult, setDrillResult] = useState<ReportDrillResult | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "pdf">("xlsx");
  const [exportStatus, setExportStatus] = useState<Item | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<ReadonlyArray<string>>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [recipientToVerify, setRecipientToVerify] = useState("");
  const [schedulePreset, setSchedulePreset] = useState<"15" | "30" | "45" | "60" | "daily" | "weekly" | "monthly" | "custom">("daily");
  const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [scheduleMonthDay, setScheduleMonthDay] = useState(1);
  const [scheduleInterval, setScheduleInterval] = useState(120);
  const [scheduleFormat, setScheduleFormat] = useState<"csv" | "xlsx" | "pdf">("csv");
  const [scheduleAnchor] = useState(() => {
    const value = new Date();
    value.setUTCSeconds(0, 0);
    value.setUTCMinutes(value.getUTCMinutes() + 1);
    return value.toISOString();
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [reportPayload, recipientPayload, contextPayload] = await Promise.all([
        requestConversionsApi<unknown>("reports.list", "/api/admin/conversions/v1/reports?limit=100", { signal }),
        requestConversionsApi<unknown>("reports.recipients", "/api/admin/conversions/v1/report-recipients", { signal }),
        requestConversionsApi<unknown>("reports.context", "/api/admin/conversions/ui-context", { signal }),
      ]);
      setReports(unwrapCorePage(reportPayload).items);
      setRecipients(unwrapCoreResultCollection(recipientPayload));
      const nextContext = unwrapConversionsUiContext(contextPayload);
      setContext(nextContext);
      setScheduleTimezone((current) => current === "UTC" ? nextContext.timeZone : current);
      setReportTimezone((current) => current === "UTC" ? nextContext.timeZone : current);
      setSelectedRecipients((current) => current.length > 0 ? current : nextContext.recipientScope.map((item) => item.recipientId));
      setStatus("Saved reports, recipient status, and permanent account scope are current.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const fields = REPORT_FIELDS[dataset];
  const dimensionFields = fields.filter((field) => field.role === "dimension");
  const measureFields = fields.filter((field) => field.role === "measure");
  const selectedFields = [...dimensions, ...measures];
  const resultFields = [...selectedFields, ...calculatedMeasures.map(({ id }) => id)];
  const modeReason = displayReason(displayMode, dataset, dimensions, measures, filters);
  const formulaReason = calculatedMeasures.map((definition) => calculationReason(dataset, definition)).find(Boolean) ?? null;
  const subtotalReason = subtotals && (displayMode !== "table" || dimensions.length < 2
    || measures.some((id) => fieldFor(dataset, id)?.additive === false))
    ? "Subtotals require a table, at least two groupings, and additive measures only." : null;
  const drillReason = drillThrough && (displayMode !== "table" || dataset !== "conversions"
    || filters.some((filter) => filter.field_id.startsWith("measure.")))
    ? "Drill-through requires a Conversions table without aggregate-measure filters." : null;
  const advancedReason = subtotalReason ?? drillReason;
  const summary = useMemo(() => {
    const dimensionLabels = dimensions.map((id) => fieldFor(dataset, id)?.label ?? id);
    const measureLabels = measures.map((id) => fieldFor(dataset, id)?.label ?? id);
    return `Show ${measureLabels.join(", ") || "no measures"} from ${dataset}, grouped by ${dimensionLabels.join(", ") || "nothing"}, for ${startDate} through the day before ${endDate} in ${reportTimezone}. ${filters.length} filter${filters.length === 1 ? "" : "s"}. Display as ${displayMode.replaceAll("_", " ")}.`;
  }, [dataset, dimensions, displayMode, endDate, filters.length, measures, reportTimezone, startDate]);

  function chooseDataset(next: Dataset) {
    const selection = defaultSelection(next);
    setDataset(next);
    setDimensions(selection.dimensions);
    setMeasures(selection.measures);
    setFilters([]);
    setCalculatedMeasures([]);
    setSortField(selection.dimensions[0] ?? selection.measures[0]);
    setDisplayMode("table");
    setPivotRowIds(selection.dimensions.slice(0, 1));
    setTopN(100);
    setSubtotals(false);
    setComparisons([]);
    setDrillThrough(false);
    setSelectedReport(null);
  }

  function toggleDimension(field: ReportField, checked: boolean) {
    setDimensions((current) => (checked ? [...current, field.id] : current.filter((id) => id !== field.id)));
    setPivotRowIds((current) => checked
      ? (dimensions.length === 0 ? [field.id] : current)
      : current.filter((id) => id !== field.id));
  }

  function toggleMeasure(field: ReportField, checked: boolean) {
    setMeasures((current) => {
      let next = checked ? [...current, field.id] : current.filter((id) => id !== field.id);
      if (checked) {
        for (const companion of field.requiredCompanions ?? []) if (!next.includes(companion)) next.push(companion);
      }
      return next;
    });
    if (checked && field.requiredDimension) {
      setDimensions((current) => current.includes(field.requiredDimension!) ? current : [...current, field.requiredDimension!]);
    }
  }

  function ensureMeasureSelected(id: string) {
    const field = fieldFor(dataset, id);
    if (!field || field.role !== "measure") return;
    setMeasures((current) => {
      const next = current.includes(id) ? [...current] : [...current, id];
      for (const companion of field.requiredCompanions ?? []) if (!next.includes(companion)) next.push(companion);
      return next;
    });
    if (field.requiredDimension) {
      setDimensions((current) => current.includes(field.requiredDimension!)
        ? current : [...current, field.requiredDimension!]);
    }
  }

  function addCalculatedMeasure() {
    const fallback = measureFields[0]?.id;
    if (!fallback || calculatedMeasures.length >= 9) return;
    ensureMeasureSelected(fallback);
    setCalculatedMeasures((current) => [...current, {
      id: `calculated.metric_${current.length + 1}`,
      label: `Calculated metric ${current.length + 1}`,
      firstMeasureId: fallback,
      steps: [{ operator: "divide", operand: { kind: "constant", value: "1.0000" } }],
    }]);
  }

  function updateCalculatedMeasure(index: number, patch: Partial<CalculatedMeasure>) {
    setCalculatedMeasures((current) => current.map((definition, itemIndex) => {
      if (itemIndex !== index) return definition;
      const next = { ...definition, ...patch };
      const id = patch.label === undefined ? next.id : calculatedId(next.label, index);
      ensureMeasureSelected(next.firstMeasureId);
      for (const step of next.steps) {
        if (step.operand.kind === "measure") ensureMeasureSelected(step.operand.value);
      }
      return { ...next, id };
    }));
  }

  function updateCalculationStep(
    definitionIndex: number,
    stepIndex: number,
    patch: Partial<CalculationStep>,
  ) {
    setCalculatedMeasures((current) => current.map((definition, itemIndex) => {
      if (itemIndex !== definitionIndex) return definition;
      const steps = definition.steps.map((step, currentStepIndex) => (
        currentStepIndex === stepIndex ? { ...step, ...patch } : step
      ));
      const next = { ...definition, steps };
      for (const step of next.steps) {
        if (step.operand.kind === "measure") ensureMeasureSelected(step.operand.value);
      }
      return next;
    }));
  }

  function applyTemplate(id: string) {
    const template = REPORT_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setName(template.name);
    setDescription(template.description);
    setDataset(template.dataset);
    setDimensions(template.dimensions);
    setMeasures(template.measures);
    setFilters([]);
    setCalculatedMeasures([]);
    setSortField(template.dimensions[0] ?? template.measures[0]);
    setSortDirection("asc");
    setDisplayMode(template.display);
    setPivotRowIds(template.dimensions.slice(0, 1));
    setSelectedReport(null);
    setTab("builder");
    setStatus("Template copied into a new editable report. The immutable seed was not changed.");
  }

  function reportDefinition(): Item {
    const config = displayConfig(displayMode, dimensions, measures, filters, pivotRowIds);
    return {
      report_version: "report_definition.v1",
      name: name.trim(),
      description: description.trim() || null,
      date_rule: { kind: "absolute_utc", start_date: startDate, end_date_exclusive: endDate },
      query_definition: {
        definition_version: "report_query_definition.v1",
        catalog_version: "reporting_semantic_catalog.v1",
        dataset,
        timezone: reportTimezone,
        dimensions,
        measures,
        filters,
        sort: sortField ? [{ field_id: sortField, direction: sortDirection }] : [],
        totals,
      },
      display_definition: {
        display_version: "report_display_definition.v1",
        mode: displayMode,
        config,
      },
      advanced_definition: {
        version: "report_advanced_definition.v1",
        calculated_measure_set: {
          version: "report_calculated_measure_set.v1",
          definitions: calculatedMeasures.map((definition) => ({
            version: "report_calculated_measure.v1",
            id: definition.id,
            label: definition.label.trim(),
            expression: calculatedExpression(definition),
          })),
        },
        top_n: topN,
        subtotals,
        comparisons,
        drill_through: { enabled: drillThrough, maximum_rows: 100 },
      },
    };
  }

  function selectedDefinitionIsCurrent(): boolean {
    return selectedReport !== null && isRecord(selectedReport.report_definition)
      && JSON.stringify(reportDefinition()) === JSON.stringify(selectedReport.report_definition);
  }

  function adminReportBody(): Item {
    if (!context) throw new CoreWireError("missing_context", "Permanent account scope is unavailable.");
    const definition = reportDefinition();
    const display = definition.display_definition as Item;
    return {
      name: name.trim(),
      description: description.trim(),
      dataset,
      timezone: reportTimezone,
      date_rule: definition.date_rule,
      dimensions,
      measures,
      calculated_measures: calculatedMeasures.map((definition) => definition.id),
      filters,
      sort: sortField ? [sortField] : [],
      top_n: topN,
      totals,
      subtotals,
      display_mode: displayMode,
      display_config: display.config,
      comparisons,
      account_ids: context.accountScope.map((item) => item.accountId),
      report_definition: definition,
    };
  }

  async function saveReport() {
    setWorking(true);
    setStatus("Validating and saving the complete report definition…");
    try {
      const id = selectedReport ? reportId(selectedReport) : "";
      const payload = await requestConversionsApi<unknown>(
        id ? `report.update:${id}:${text(selectedReport!, "row_version")}` : `report.create:${name}`,
        id ? `/api/admin/conversions/v1/reports/${id}` : "/api/admin/conversions/v1/reports",
        {
          method: id ? "PATCH" : "POST",
          body: id ? { ...adminReportBody(), row_version: Number(selectedReport!.row_version) } : adminReportBody(),
        },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.report)) throw new CoreWireError("invalid_response", "The service returned an invalid saved report.");
      const report = result.report;
      setSelectedReport(report);
      setReports((current) => [report, ...current.filter((item) => reportId(item) !== reportId(report))]);
      history.replaceState(null, "", `/admin/reporting/${reportId(report)}`);
      setStatus("Report saved with a stable URL and immutable definition hashes.");
      setTab("results");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function editReport(item: Item) {
    const id = reportId(item);
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(`report.get:${id}`, `/api/admin/conversions/v1/reports/${id}`);
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.report) || !isRecord(result.report.report_definition)) {
        throw new CoreWireError("invalid_response", "The service returned an invalid saved report.");
      }
      const report = result.report;
      const definition = report.report_definition as Item;
      const query = definition.query_definition as Item;
      const display = definition.display_definition as Item;
      setSelectedReport(report);
      setName(text(definition, "name", "Untitled report"));
      setDescription(text(definition, "description", ""));
      setDataset(query.dataset as Dataset);
      setDimensions(Array.isArray(query.dimensions) ? query.dimensions as string[] : []);
      setMeasures(Array.isArray(query.measures) ? query.measures as string[] : []);
      setFilters(Array.isArray(query.filters) ? query.filters as Filter[] : []);
      const sort = Array.isArray(query.sort) && isRecord(query.sort[0]) ? query.sort[0] : null;
      setSortField(sort ? text(sort, "field_id", "") : "");
      setSortDirection(sort?.direction === "desc" ? "desc" : "asc");
      setTotals(query.totals === true);
      setReportTimezone(text(query, "timezone", "UTC"));
      setDisplayMode(display.mode as DisplayMode);
      const displayConfigValue = isRecord(display.config) ? display.config : null;
      setPivotRowIds(displayConfigValue && Array.isArray(displayConfigValue.row_dimension_ids)
        ? displayConfigValue.row_dimension_ids.filter((id): id is string => typeof id === "string")
        : (Array.isArray(query.dimensions) ? (query.dimensions as string[]).slice(0, 1) : []));
      const advanced = isRecord(definition.advanced_definition) ? definition.advanced_definition : null;
      const calculatedSet = advanced && isRecord(advanced.calculated_measure_set)
        ? advanced.calculated_measure_set : null;
      const storedDefinitions = calculatedSet && Array.isArray(calculatedSet.definitions)
        ? calculatedSet.definitions : [];
      const captureStoredExpression = (value: unknown): {
        firstMeasureId: string;
        steps: ReadonlyArray<CalculationStep>;
      } | null => {
        if (!isRecord(value)) return null;
        if (value.kind === "measure" && typeof value.field_id === "string") {
          return { firstMeasureId: value.field_id, steps: [] };
        }
        if (value.kind !== "binary" || typeof value.operator !== "string"
          || !["add", "subtract", "multiply", "divide"].includes(value.operator)
          || !isRecord(value.right)) return null;
        const left = captureStoredExpression(value.left);
        if (!left || (value.right.kind !== "measure" && value.right.kind !== "constant")) return null;
        const operandValue = value.right.kind === "measure" ? value.right.field_id : value.right.value;
        if (typeof operandValue !== "string") return null;
        return {
          firstMeasureId: left.firstMeasureId,
          steps: [...left.steps, {
            operator: value.operator as CalculationOperator,
            operand: { kind: value.right.kind, value: operandValue },
          }],
        };
      };
      setCalculatedMeasures(storedDefinitions.flatMap((candidate, index) => {
        if (!isRecord(candidate) || typeof candidate.id !== "string"
          || typeof candidate.label !== "string") return [];
        const expression = captureStoredExpression(candidate.expression);
        if (!expression || expression.steps.length < 1) return [];
        return [{
          id: candidate.id,
          label: candidate.label,
          firstMeasureId: expression.firstMeasureId,
          steps: expression.steps,
        }];
      }));
      setTopN(advanced && Number.isSafeInteger(advanced.top_n) ? Number(advanced.top_n) : 100);
      setSubtotals(advanced?.subtotals === true);
      setComparisons(advanced && Array.isArray(advanced.comparisons)
        ? advanced.comparisons.filter((value): value is Comparison => value === "prior_period" || value === "year_over_year")
        : []);
      setDrillThrough(advanced && isRecord(advanced.drill_through)
        ? advanced.drill_through.enabled === true : false);
      if (isRecord(definition.date_rule)) {
        setStartDate(text(definition.date_rule, "start_date", startDate));
        setEndDate(text(definition.date_rule, "end_date_exclusive", endDate));
      }
      history.replaceState(null, "", `/admin/reporting/${id}`);
      setTab("builder");
      setStatus("Saved definition loaded. Changes do not apply until Save.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function runReport(cursor?: string) {
    if (!selectedReport) {
      setStatus("Save the report first so the query is bound to an immutable row version.");
      return;
    }
    if (!selectedDefinitionIsCurrent()) {
      setStatus("Save or discard the builder changes before running the saved report version.");
      return;
    }
    setWorking(true);
    setStatus("Running a date-bounded, parameterized report query…");
    try {
      const id = reportId(selectedReport);
      const payload = await requestConversionsApi<unknown>(
        `report.query:${id}:${startDate}:${endDate}:${cursor ?? "first"}`,
        `/api/admin/conversions/v1/reports/${id}/query`,
        { method: "POST", body: {
          report_row_version: Number(selectedReport.row_version),
          concrete_date_range: { start: startDate, end: endDate },
          page_limit: Math.min(1000, topN),
          ...(cursor ? { cursor } : {}),
        } },
      );
      const rows = unwrapCalculatedReportQueryRows(payload);
      setComparisonResults(unwrapReportComparisonRows(payload));
      setAdvancedResult(unwrapReportAdvancedResult(payload));
      setDrillResult(null);
      setResults((current) => cursor ? [...current, ...rows] : rows);
      setNextCursor(isRecord(payload) && typeof payload.next_cursor === "string" ? payload.next_cursor : null);
      setStatus(`Query completed with ${rows.length} row${rows.length === 1 ? "" : "s"} on this page.`);
      setTab("results");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function runPreview() {
    setWorking(true);
    setStatus("Running the unsaved definition as a read-only preview…");
    try {
      const payload = await requestConversionsApi<unknown>(
        `report.preview:${name}:${startDate}:${endDate}:${reportTimezone}`,
        "/api/admin/conversions/v1/reports/preview",
        {
          method: "POST",
          body: {
            ...adminReportBody(),
            concrete_date_range: { start: startDate, end: endDate },
            page_limit: Math.min(1000, topN),
          },
        },
      );
      const rows = unwrapCalculatedReportQueryRows(payload);
      setComparisonResults(unwrapReportComparisonRows(payload));
      setAdvancedResult(unwrapReportAdvancedResult(payload));
      setDrillResult(null);
      setResults(rows);
      setNextCursor(null);
      setStatus(`Read-only preview completed with ${rows.length} row${rows.length === 1 ? "" : "s"}. Nothing was saved.`);
      setTab("results");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function duplicateReport(item: Item) {
    const id = reportId(item);
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `report.duplicate:${id}`,
        `/api/admin/conversions/v1/reports/${id}/duplicate`,
        { method: "POST", body: { name: `${text(item, "name", "Report")} copy` } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.report)) throw new CoreWireError("invalid_response", "Invalid duplicate response.");
      setReports((current) => [result.report as Item, ...current]);
      setStatus("Report duplicated. The original definition was not changed.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function runDrillThrough(row: Item) {
    if (!selectedReport || !advancedResult?.drillThrough.enabled) return;
    if (!selectedDefinitionIsCurrent()) {
      setStatus("Save or discard the builder changes before opening details from the saved report.");
      return;
    }
    setWorking(true);
    setStatus("Loading the authorized detail rows behind this exact grouping…");
    try {
      const id = reportId(selectedReport);
      const groupingValues = dimensions.map((fieldId) => {
        const value = row[fieldId];
        if (typeof value !== "string") throw new CoreWireError("invalid_grouping", "This row cannot be drilled into because a grouping value is unavailable.");
        return { field_id: fieldId, value };
      });
      const payload = await requestConversionsApi<unknown>(
        `report.drill:${id}:${advancedResult.drillThrough.snapshotSha256}:${JSON.stringify(groupingValues)}`,
        `/api/admin/conversions/v1/reports/${id}/drill-through`,
        { method: "POST", body: {
          report_row_version: Number(selectedReport.row_version),
          concrete_date_range: { start: startDate, end: endDate },
          snapshot_sha256: advancedResult.drillThrough.snapshotSha256,
          grouping_values: groupingValues,
          page_limit: Math.min(100, advancedResult.drillThrough.maximumRows),
        } },
      );
      const detail = unwrapReportDrillResult(payload);
      setDrillResult(detail);
      setStatus(`Loaded ${detail.rows.length} authorized detail row${detail.rows.length === 1 ? "" : "s"} from the immutable filter snapshot.`);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function archiveReport(item: Item) {
    const id = reportId(item);
    setWorking(true);
    try {
      await requestConversionsApi(
        `report.archive:${id}:${text(item, "row_version")}`,
        `/api/admin/conversions/v1/reports/${id}/archive`,
        { method: "POST", body: { row_version: Number(item.row_version), reason: "operator_archived" } },
      );
      setReports((current) => current.filter((candidate) => reportId(candidate) !== id));
      if (selectedReport && reportId(selectedReport) === id) setSelectedReport(null);
      setStatus("Report archived. Existing export audit records remain.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function createExport() {
    if (!selectedReport) return;
    if (!selectedDefinitionIsCurrent()) {
      setStatus("Save or discard the builder changes before exporting the immutable saved version.");
      return;
    }
    setWorking(true);
    try {
      const id = reportId(selectedReport);
      const payload = await requestConversionsApi<unknown>(
        `export.create:${id}:${exportFormat}`,
        "/api/admin/conversions/v1/exports",
        { method: "POST", body: {
          report_id: id,
          report_row_version: Number(selectedReport.row_version),
          format: exportFormat,
        } },
      );
      setExportStatus(unwrapExportStatus(payload));
      setStatus(`${exportFormat.toUpperCase()} export queued from the immutable saved definition. Refresh its status until the signed download is ready.`);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function refreshExport() {
    const current = exportResource(exportStatus);
    const exportId = current && typeof current.export_id === "string" ? current.export_id : null;
    if (!exportId) return;
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `export.status:${exportId}`,
        `/api/admin/conversions/v1/exports/${exportId}`,
      );
      const next = unwrapExportStatus(payload);
      setExportStatus(next);
      const resource = exportResource(next);
      setStatus(resource?.status === "completed"
        ? "Export completed. Use the actor-authorized signed download."
        : resource?.status === "failed"
          ? "Export generation failed. The safe failure status is shown below."
          : "Export is still queued or generating.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function addRecipient(recipientId: string) {
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `recipient.create:${recipientId}`,
        "/api/admin/conversions/v1/report-recipients",
        { method: "POST", body: { recipient_id: recipientId } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.recipient)) throw new CoreWireError("invalid_response", "Invalid recipient response.");
      setRecipients((current) => [result.recipient as Item, ...current.filter((item) => item.recipient_id !== recipientId)]);
      setRecipientToVerify(recipientId);
      setStatus("Verification challenge created for the approved CMS recipient reference. Enter its six-digit code.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function verifyRecipient() {
    if (!recipientToVerify) return;
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `recipient.verify:${recipientToVerify}:${verificationCode}`,
        `/api/admin/conversions/v1/report-recipients/${recipientToVerify}/verify`,
        { method: "POST", body: { verification_code: verificationCode } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.recipient)) throw new CoreWireError("invalid_response", "Invalid verification response.");
      setRecipients((current) => [result.recipient as Item, ...current.filter((item) => item.recipient_id !== recipientToVerify)]);
      setVerificationCode("");
      setRecipientToVerify("");
      setStatus("Recipient verified. It can now be selected for a disabled schedule.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function loadSchedules() {
    if (!selectedReport) return;
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `schedules.list:${reportId(selectedReport)}`,
        `/api/admin/conversions/v1/reports/${reportId(selectedReport)}/schedules?limit=25`,
      );
      setSchedules(unwrapCorePage(payload).items);
      setStatus("Disabled schedules loaded. No schedule is allowed to send in this release state.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  async function createDisabledSchedule() {
    if (!selectedReport) return;
    if (!selectedDefinitionIsCurrent()) {
      setStatus("Save or discard the builder changes before scheduling the immutable saved version.");
      return;
    }
    const recurrence: Item = ["15", "30", "45", "60", "custom"].includes(schedulePreset)
      ? {
        schema_version: 1,
        type: "interval",
        timezone: scheduleTimezone,
        catch_up_policy: "serial_24h",
        interval_minutes: schedulePreset === "custom" ? scheduleInterval : Number(schedulePreset),
        anchor_at: scheduleAnchor,
      }
      : schedulePreset === "weekly"
        ? {
          schema_version: 1, type: "weekly", timezone: scheduleTimezone,
          catch_up_policy: "serial_24h", weekdays: [scheduleWeekday], local_time: scheduleTime,
        }
        : schedulePreset === "monthly"
          ? {
            schema_version: 1, type: "monthly", timezone: scheduleTimezone,
            catch_up_policy: "serial_24h", day_of_month: scheduleMonthDay, local_time: scheduleTime,
          }
          : {
            schema_version: 1, type: "daily", timezone: scheduleTimezone,
            catch_up_policy: "serial_24h", local_time: scheduleTime,
          };
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `schedule.create:${reportId(selectedReport)}:${schedulePreset}:${scheduleTimezone}:${scheduleFormat}:${selectedRecipients.join(",")}`,
        `/api/admin/conversions/v1/reports/${reportId(selectedReport)}/schedules`,
        { method: "POST", body: {
          enabled: false,
          recipient_ids: [...selectedRecipients].sort(),
          recurrence,
          format: scheduleFormat,
        } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !isRecord(result.schedule)) throw new CoreWireError("invalid_response", "Invalid schedule response.");
      setSchedules((current) => [result.schedule as Item, ...current]);
      setStatus("Disabled schedule saved with its timezone, recurrence, format, immutable report version, and verified recipients. It cannot send until a separate activation gate is approved.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorking(false);
    }
  }

  const verifiedRecipientIds = new Set(recipients.filter((item) => item.verification_status === "verified").map((item) => text(item, "recipient_id", "")));
  const currentExport = exportResource(exportStatus);
  const exportDownload = exportStatus && isRecord(exportStatus.download)
    ? exportStatus.download
    : currentExport && isRecord(currentExport.download) ? currentExport.download : null;
  const exportPath = exportDownload && typeof exportDownload.path === "string"
    ? exportDownload.path : null;
  const savedDefinitionCurrent = selectedDefinitionIsCurrent();
  const builderInvalid = working || !name.trim() || measures.length === 0
    || startDate >= endDate || modeReason !== null || formulaReason !== null || advancedReason !== null
    || filters.some((filter) => filter.operator !== "is_empty" && !filter.value);

  return <ShellFrame section="reports" bootstrapActive={props.bootstrapActive}>
    <div class="ko-product-toolbar">
      <div class="ko-view-tabs" role="tablist" aria-label="Reporting workflow">
        {(["library", "builder", "results", "delivery"] as const).map((item) => <button
          class={`ko-button${tab === item ? " ko-button--primary" : ""}`} type="button" role="tab" aria-selected={tab === item}
          onClick={() => setTab(item)}
        >{item === "delivery" ? "Export & schedule" : item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>
      <button class="ko-button" type="button" disabled={loading || working} onClick={() => void load()}>Refresh</button>
    </div>
    <p class="ko-product-live" role="status" aria-live="polite">{status}</p>
    {loading && <div class="ko-loading" aria-busy="true"><span class="ko-spinner" />Loading Reporting…</div>}

    {!loading && tab === "library" && <section class="ko-report-library">
      <div class="ko-config-section"><h3>Start from a proven template</h3><p>Templates are immutable seeds. Opening one creates a new editable report.</p>
        <div class="ko-template-grid">{REPORT_TEMPLATES.map((template) => <article>
          <h4>{template.name}</h4><p>{template.description}</p>
          <button class="ko-button" type="button" onClick={() => applyTemplate(template.id)}>Use template</button>
        </article>)}</div>
      </div>
      <div class="ko-config-section"><div class="ko-form-heading"><div><h3>Saved reports</h3><p>Each report has a stable URL and immutable definition hashes per row version.</p></div>
        <button class="ko-button ko-button--primary" type="button" onClick={() => { setSelectedReport(null); history.replaceState(null, "", "/admin/reporting/new"); setTab("builder"); }}>New blank report</button></div>
        {reports.length === 0 ? <div class="ko-conversions-state"><h3>No saved reports</h3><p>Use a template or create a blank report.</p></div>
          : <div class="ko-table-scroll"><table class="ko-resource-table"><thead><tr><th>Name</th><th>Dataset</th><th>Updated</th><th>Version</th><th>Actions</th></tr></thead><tbody>
            {reports.map((report) => <tr key={reportId(report)}><th>{text(report, "name")}</th><td>{text(report, "dataset")}</td><td>{text(report, "updated_at")}</td><td>{text(report, "row_version")}</td>
              <td><div class="ko-button-row"><button class="ko-button ko-button--small" type="button" onClick={() => void editReport(report)}>Open</button>
                <button class="ko-button ko-button--small" type="button" onClick={() => void duplicateReport(report)}>Duplicate</button>
                <button class="ko-button ko-button--small" type="button" onClick={() => void archiveReport(report)}>Archive</button></div></td></tr>)}
          </tbody></table></div>}
      </div>
    </section>}

    {!loading && tab === "builder" && <div class="ko-report-builder">
      <section class="ko-report-builder-main">
        <div class="ko-config-section"><h3>1. What should this report answer?</h3>
          <div class="ko-config-grid">
            <label class="ko-config-field">Report name<input value={name} maxLength={120} onInput={(event) => setName(event.currentTarget.value)} /></label>
            <label class="ko-config-field">Dataset<select value={dataset} onChange={(event) => chooseDataset(event.currentTarget.value as Dataset)}>
              <option value="conversions">Conversions — business outcomes and value</option>
              <option value="deliveries">Deliveries — external attempt and outcome health</option>
              <option value="runs">Runs — source ingestion quality and timing</option>
            </select></label>
          </div>
          <label class="ko-config-field">Description<textarea rows={2} value={description} onInput={(event) => setDescription(event.currentTarget.value)} /></label>
          <div class="ko-config-grid">
            <label class="ko-config-field">Start date<input type="date" value={startDate} onInput={(event) => setStartDate(event.currentTarget.value)} /></label>
            <label class="ko-config-field">End date (exclusive)<input type="date" value={endDate} onInput={(event) => setEndDate(event.currentTarget.value)} /></label>
            <label class="ko-config-field">Report timezone<input list="ko-report-query-timezones" value={reportTimezone} maxLength={64} onInput={(event) => setReportTimezone(event.currentTarget.value)} />
              <datalist id="ko-report-query-timezones"><option value="UTC" /><option value={context?.timeZone ?? "UTC"} /><option value="America/New_York" /><option value="Europe/London" /><option value="Asia/Jerusalem" /></datalist>
              <small>IANA timezone used for report dates, hours, comparisons, previews, and exports. Non-UTC reports use the current-state projection so day boundaries stay truthful.</small></label>
          </div>
        </div>
        <div class="ko-reporting-layout">
          <FieldPicker title="Groupings" fields={dimensionFields} selected={dimensions} onToggle={toggleDimension} />
          <FieldPicker title="Measures" fields={measureFields} selected={measures} onToggle={toggleMeasure} />
        </div>
        <section class="ko-config-section"><div class="ko-form-heading"><div>
          <h3>3. Calculated measures</h3>
          <p>Build a safe metric from approved measures and numbers. Each added operation wraps the result in parentheses, so its order is explicit. The server validates the structured formula; no code or formula text is executed.</p>
        </div><button class="ko-button" type="button" disabled={calculatedMeasures.length >= 9} onClick={addCalculatedMeasure}>Add calculated measure</button></div>
          {calculatedMeasures.length === 0 && <p class="ko-muted">Optional. Add one for a rate, difference, or scaled value.</p>}
          {calculatedMeasures.map((definition, index) => {
            const reason = calculationReason(dataset, definition);
            return <fieldset class="ko-calculated-measure">
            <legend>Calculated measure {index + 1}</legend>
            <div class="ko-config-grid">
              <label class="ko-config-field">Label<input value={definition.label} maxLength={96} onInput={(event) => updateCalculatedMeasure(index, { label: event.currentTarget.value })} /></label>
              <label class="ko-config-field">First measure<select value={definition.firstMeasureId} onChange={(event) => updateCalculatedMeasure(index, { firstMeasureId: event.currentTarget.value })}>
                {measureFields.map((field) => <option value={field.id}>{field.label}</option>)}
              </select></label>
            </div>
            {definition.steps.map((step, stepIndex) => <fieldset class="ko-formula-step">
              <legend>Operation {stepIndex + 1}</legend>
              <div class="ko-config-grid">
                <label class="ko-config-field">Operation<select value={step.operator} onChange={(event) => updateCalculationStep(index, stepIndex, { operator: event.currentTarget.value as CalculationOperator })}>
                  <option value="add">plus (+)</option><option value="subtract">minus (−)</option>
                  <option value="multiply">times (×)</option><option value="divide">divided by (÷, zero becomes unavailable)</option>
                </select></label>
                <label class="ko-config-field">Value type<select value={step.operand.kind} onChange={(event) => {
                  const kind = event.currentTarget.value as CalculationOperand["kind"];
                  updateCalculationStep(index, stepIndex, {
                    operand: { kind, value: kind === "measure" ? measureFields[0].id : "1.0000" },
                  });
                }}><option value="measure">Another measure</option><option value="constant">A number</option></select></label>
                {step.operand.kind === "measure"
                  ? <label class="ko-config-field">Measure<select value={step.operand.value} onChange={(event) => updateCalculationStep(index, stepIndex, { operand: { kind: "measure", value: event.currentTarget.value } })}>
                    {measureFields.map((field) => <option value={field.id}>{field.label}</option>)}
                  </select></label>
                  : <label class="ko-config-field">Number<input inputMode="decimal" pattern="-?(0|[1-9][0-9]{0,13})\.[0-9]{4}" value={step.operand.value} onInput={(event) => updateCalculationStep(index, stepIndex, { operand: { kind: "constant", value: event.currentTarget.value } })} /><small>Use four decimal places, for example 100.0000.</small></label>}
              </div>
              <button class="ko-button ko-button--small" type="button" disabled={definition.steps.length === 1} onClick={() => updateCalculatedMeasure(index, { steps: definition.steps.filter((_, currentStepIndex) => currentStepIndex !== stepIndex) })}>Remove operation</button>
            </fieldset>)}
            <p class="ko-formula-sentence" aria-label="Calculated formula preview">{calculationSentence(dataset, definition)}</p>
            {reason && <p class="ko-disabled-reason">{reason}</p>}
            <div class="ko-button-row">
              <button class="ko-button ko-button--small" type="button" disabled={definition.steps.length >= 16} onClick={() => updateCalculatedMeasure(index, { steps: [...definition.steps, { operator: "add", operand: { kind: "constant", value: "0.0000" } }] })}>Add parenthesized operation</button>
              <button class="ko-button ko-button--small" type="button" onClick={() => setCalculatedMeasures((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove calculated measure</button>
            </div>
          </fieldset>;})}
        </section>
        <section class="ko-config-section"><h3>4. Filter and order</h3>
          {filters.map((filter, index) => {
            const field = fieldFor(dataset, filter.field_id) ?? fields[0];
            return <div class="ko-report-filter-row">
              <select aria-label={`Filter ${index + 1} field`} value={filter.field_id} onChange={(event) => {
                const nextField = fieldFor(dataset, event.currentTarget.value)!;
                setFilters(filters.map((item, itemIndex) => itemIndex === index ? { field_id: nextField.id, operator: nextField.operators[0], value: "" } : item));
              }}>{fields.map((item) => <option value={item.id}>{item.label}</option>)}</select>
              <select aria-label={`Filter ${index + 1} operator`} value={filter.operator} onChange={(event) => {
                const operator = event.currentTarget.value as Operator;
                setFilters(filters.map((item, itemIndex) => itemIndex === index ? { field_id: item.field_id, operator, ...(operator === "is_empty" ? {} : { value: item.value ?? "" }) } : item));
              }}>{field.operators.map((operator) => <option value={operator}>{OPERATOR_LABELS[operator]}</option>)}</select>
              {filter.operator !== "is_empty" && <input
                aria-label={`Filter ${index + 1} value`}
                type={field.type === "date" ? "date" : "text"}
                inputMode={["uint64", "decimal", "ratio"].includes(field.type) ? "decimal" : undefined}
                placeholder={field.type === "uuid" ? "Paste the exact ID" : undefined}
                value={filter.value ?? ""}
                onInput={(event) => setFilters(filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.currentTarget.value } : item))}
              />}
              <button class="ko-button ko-button--small" type="button" onClick={() => setFilters(filters.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
            </div>;
          })}
          <button class="ko-button" type="button" disabled={filters.length >= 24} onClick={() => {
            const field = fields[0]; setFilters([...filters, { field_id: field.id, operator: field.operators[0], value: "" }]);
          }}>Add filter</button>
          <div class="ko-config-grid">
            <label class="ko-config-field">Sort by<select value={sortField} onChange={(event) => setSortField(event.currentTarget.value)}>
              <option value="">Automatic stable order</option>{selectedFields.map((id) => <option value={id}>{fieldFor(dataset, id)?.label ?? id}</option>)}
            </select></label>
            <label class="ko-config-field">Direction<select value={sortDirection} onChange={(event) => setSortDirection(event.currentTarget.value as "asc" | "desc")}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          </div>
        </section>
        <section class="ko-config-section"><h3>5. Choose the display</h3>
          <div class="ko-display-grid">{DISPLAY_LABELS.map(([mode, label]) => {
            const reason = displayReason(mode, dataset, dimensions, measures, filters);
            return <label class={`ko-display-option${displayMode === mode ? " ko-display-option--selected" : ""}`}>
              <input type="radio" name="display-mode" value={mode} checked={displayMode === mode} disabled={reason !== null} onChange={() => {
                setDisplayMode(mode);
                if (mode === "kpi") setTotals(false);
                if (mode !== "table") setSubtotals(false);
              }} />
              <strong>{label}</strong>{reason && <small>{reason}</small>}
            </label>;
          })}</div>
          {displayMode === "pivot" && <section class="ko-pivot-layout"><h4>Pivot layout</h4><p>Choose whether each grouping is a row or column, then use the move controls to set its order. The saved definition keeps stable field IDs.</p>
            <div class="ko-table-scroll"><table class="ko-resource-table"><thead><tr><th scope="col">Grouping</th><th scope="col">Area</th><th scope="col">Order</th></tr></thead>
              <tbody>{dimensions.map((id, index) => <tr><th scope="row">{fieldFor(dataset, id)?.label ?? id}</th><td><select aria-label={`${fieldFor(dataset, id)?.label ?? id} pivot area`} value={pivotRowIds.includes(id) ? "row" : "column"} onChange={(event) => setPivotRowIds((current) => event.currentTarget.value === "row" ? [...current, id].filter((value, itemIndex, values) => values.indexOf(value) === itemIndex) : current.filter((value) => value !== id))}><option value="row">Rows</option><option value="column">Columns</option></select></td>
                <td><div class="ko-button-row"><button class="ko-button ko-button--small" type="button" disabled={index === 0} onClick={() => setDimensions((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Move up</button>
                  <button class="ko-button ko-button--small" type="button" disabled={index === dimensions.length - 1} onClick={() => setDimensions((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>Move down</button></div></td></tr>)}</tbody>
            </table></div>
            <h4>Measure order</h4><div class="ko-button-column">{measures.map((id, index) => <div class="ko-recipient-row"><strong>{fieldFor(dataset, id)?.label ?? id}</strong><div class="ko-button-row"><button class="ko-button ko-button--small" type="button" disabled={index === 0} onClick={() => setMeasures((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Move up</button><button class="ko-button ko-button--small" type="button" disabled={index === measures.length - 1} onClick={() => setMeasures((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>Move down</button></div></div>)}</div>
          </section>}
          <label class="ko-checkbox"><input type="checkbox" checked={totals} onChange={(event) => setTotals(event.currentTarget.checked)} /><span>Include server-calculated totals</span></label>
        </section>
        <section class="ko-config-section"><h3>6. Limit, compare, and drill into results</h3>
          <div class="ko-config-grid">
            <label class="ko-config-field">Top rows<input type="number" min={1} max={1000} value={topN} onInput={(event) => setTopN(Math.min(1000, Math.max(1, Number(event.currentTarget.value) || 1)))} /><small>Applies after the stable server order.</small></label>
            <label class="ko-checkbox"><input type="checkbox" checked={subtotals} disabled={dimensions.length < 2 || displayMode !== "table" || measures.some((id) => fieldFor(dataset, id)?.additive === false)} onChange={(event) => setSubtotals(event.currentTarget.checked)} /><span>Subtotals for grouped table levels</span><small>{dimensions.length < 2 ? "Choose at least two groupings." : displayMode !== "table" ? "Subtotals are available for tables." : measures.some((id) => fieldFor(dataset, id)?.additive === false) ? "Ratios and non-additive measures cannot be summed into subtotals." : "Server-calculated from additive bases."}</small></label>
            <label class="ko-checkbox"><input type="checkbox" checked={drillThrough} disabled={displayMode !== "table" || dataset !== "conversions" || filters.some((filter) => filter.field_id.startsWith("measure."))} onChange={(event) => setDrillThrough(event.currentTarget.checked)} /><span>Allow controlled drill-through</span><small>{dataset !== "conversions" ? "Detail facts are available for Conversions reports." : filters.some((filter) => filter.field_id.startsWith("measure.")) ? "Remove aggregate-measure filters before enabling detail rows." : "Opens at most 100 authorized conversion facts with the exact date and filter snapshot."}</small></label>
          </div>
          <fieldset class="ko-selection-list"><legend>Comparison</legend>
            {([["prior_period", "Previous period"], ["year_over_year", "Same period last year"]] as const).map(([value, label]) => <label>
              <input type="checkbox" checked={comparisons.includes(value)} onChange={(event) => setComparisons((current) => event.currentTarget.checked ? [...current, value].sort() as Comparison[] : current.filter((item) => item !== value))} />{label}
            </label>)}
          </fieldset>
        </section>
      </section>
      <aside class="ko-report-summary"><h3>Report sentence</h3><p>{summary}</p>
        <h4>Safety rules applied</h4><ul><li>Only authorized account IDs from permanent CMS authority.</li><li>Date bounds are mandatory.</li><li>No SQL, JSON, cron, or executable formula input.</li><li>Currency measures add their required currency/FX fields automatically.</li></ul>
        {(modeReason || formulaReason || advancedReason) && <p class="ko-disabled-reason">{modeReason ?? formulaReason ?? advancedReason}</p>}
        <div class="ko-button-row"><button class="ko-button ko-button--primary" type="button" disabled={builderInvalid} onClick={() => void runPreview()}>Run preview</button>
          <button class="ko-button" type="button" disabled={builderInvalid} onClick={() => void saveReport()}>{selectedReport ? "Save changes" : "Save report"}</button>
          {selectedReport && <button class="ko-button" type="button" disabled={working || !savedDefinitionCurrent} title={savedDefinitionCurrent ? undefined : "Save or discard builder changes first."} onClick={() => void runReport()}>Run saved report</button>}</div>
      </aside>
    </div>}

    {!loading && tab === "results" && <section class="ko-config-section"><div class="ko-form-heading"><div><h3>Query result</h3><p>{selectedReport ? "Exact server rows for the saved row version and concrete date range." : "Exact server rows for the unsaved read-only definition preview."}</p></div>
      <button class="ko-button ko-button--primary" type="button" disabled={working || Boolean(selectedReport && !savedDefinitionCurrent)} title={selectedReport && !savedDefinitionCurrent ? "Save or discard builder changes first." : undefined} onClick={() => void (selectedReport ? runReport() : runPreview())}>Run / refresh</button></div>
      <ResultVisual rows={results} mode={displayMode} fields={resultFields} dataset={dataset} pivotRowIds={pivotRowIds} comparisons={comparisonResults} />
      {comparisonResults.map((comparison) => <section class="ko-comparison-result">
        <h4>{comparison.kind === "prior_period" ? "Previous period" : "Same period last year"}</h4>
        <p>{comparison.dateRange.start} through the day before {comparison.dateRange.end}, using the same timezone, filters, groupings, and measures.</p>
        <ResultVisual rows={comparison.rows} mode={displayMode} fields={resultFields} dataset={dataset} pivotRowIds={pivotRowIds} />
        {comparison.rows.length > 0 && <div class="ko-table-scroll"><table class="ko-resource-table"><caption>Exact comparison values</caption>
          <thead><tr>{Object.keys(comparison.rows[0]).map((key) => <th scope="col">{fieldFor(dataset, key)?.label ?? key.replaceAll("_", " ")}</th>)}</tr></thead>
          <tbody>{comparison.rows.map((row) => <tr>{Object.keys(comparison.rows[0]).map((key) => <td>{row[key] === null ? "Not available" : String(row[key])}</td>)}</tr>)}</tbody>
        </table></div>}
      </section>)}
      {results.length > 0 && <div class="ko-table-scroll"><table class="ko-resource-table"><caption>Exact report values</caption><thead><tr>{Object.keys(results[0]).map((key) => <th scope="col">{fieldFor(dataset, key)?.label ?? key.replaceAll("_", " ")}</th>)}{advancedResult?.drillThrough.enabled && <th scope="col">Details</th>}</tr></thead>
        <tbody>{results.map((row) => <tr>{Object.keys(results[0]).map((key) => <td>{row[key] === null ? "Not available" : String(row[key])}</td>)}{advancedResult?.drillThrough.enabled && <td><button class="ko-button ko-button--small" type="button" disabled={!selectedReport || working} onClick={() => void runDrillThrough(row)}>{selectedReport ? "View details" : "Save to view details"}</button></td>}</tr>)}</tbody></table></div>}
      {advancedResult && advancedResult.subtotals.length > 0 && <div class="ko-table-scroll"><table class="ko-resource-table"><caption>Server-calculated subtotals</caption>
        <thead><tr><th scope="col">Grouping level</th><th scope="col">Grouping</th><th scope="col">Subtotal values</th></tr></thead>
        <tbody>{advancedResult.subtotals.map((subtotal) => <tr><td>{subtotal.level}</td><td>{Object.entries(subtotal.grouping).map(([key, value]) => `${fieldFor(dataset, key)?.label ?? key}: ${String(value)}`).join(" · ")}</td><td>{Object.entries(subtotal.values).map(([key, value]) => `${fieldFor(dataset, key)?.label ?? key}: ${String(value)}`).join(" · ")}</td></tr>)}</tbody>
      </table></div>}
      {drillResult && <section class="ko-config-section"><h4>Authorized detail rows</h4><p>Bound to the report row version, date range, filters, and clicked grouping. Maximum 100 rows.</p>
        {drillResult.rows.length === 0 ? <p>No underlying detail rows matched.</p> : <div class="ko-table-scroll"><table class="ko-resource-table"><caption>Conversion detail facts</caption>
          <thead><tr>{drillResult.fields.map((field) => <th scope="col">{field.label}</th>)}</tr></thead>
          <tbody>{drillResult.rows.map((row) => <tr>{drillResult.fields.map((field) => <td>{row[field.fieldId] === null ? "Not set" : String(row[field.fieldId])}</td>)}</tr>)}</tbody>
        </table></div>}
      </section>}
      {nextCursor && <button class="ko-button" type="button" disabled={working} onClick={() => void runReport(nextCursor)}>Load next page</button>}
    </section>}

    {!loading && tab === "delivery" && <div class="ko-reporting-layout">
      <section class="ko-config-section"><h3>Export the saved definition</h3><p>CSV, XLSX, and PDF preserve the displayed timezone and column order. Download links expire.</p>
        <label class="ko-config-field">Format<select value={exportFormat} onChange={(event) => setExportFormat(event.currentTarget.value as "csv" | "xlsx" | "pdf")}><option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="pdf">PDF</option></select></label>
        <div class="ko-button-row"><button class="ko-button ko-button--primary" type="button" disabled={!selectedReport || working || !savedDefinitionCurrent} onClick={() => void createExport()}>Create export</button>
          <button class="ko-button" type="button" disabled={!currentExport || working} onClick={() => void refreshExport()}>Refresh export status</button></div>
        {currentExport && <article class="ko-export-status" role="status">
          <h4>{text(currentExport, "format").toUpperCase()} export: {text(currentExport, "status")}</h4>
          <dl><div><dt>Rows</dt><dd>{text(currentExport, "row_count", "Pending")}</dd></div>
            <div><dt>Size</dt><dd>{text(currentExport, "byte_count", "Pending")}</dd></div>
            <div><dt>Requested</dt><dd>{text(currentExport, "requested_at")}</dd></div>
            <div><dt>Expires</dt><dd>{text(currentExport, "expires_at")}</dd></div></dl>
          {currentExport.status === "queued" && <p>Generation is queued or running. Refresh this status; creating another job is not required.</p>}
          {currentExport.status === "failed" && <p>Generation failed with safe code: {text(currentExport, "error_code", "unavailable")}.</p>}
        </article>}
        {exportPath && <a class="ko-button" href={exportPath}>Download signed export</a>}
      </section>
      <section class="ko-config-section"><h3>Verified recipients</h3><p>Recipients come from the permanent CMS allowlist. Raw addresses are not invented inside Reporting.</p>
        {context?.recipientScope.map((recipient) => {
          const state = recipients.find((item) => item.recipient_id === recipient.recipientId);
          return <article class="ko-recipient-row"><div><strong>{recipient.displayLabel}</strong><small>{state ? text(state, "verification_status") : "Not enrolled"}</small></div>
            {!state && <button class="ko-button ko-button--small" type="button" onClick={() => void addRecipient(recipient.recipientId)}>Start verification</button>}</article>;
        })}
        {recipientToVerify && <div class="ko-config-grid"><label class="ko-config-field">Six-digit verification code<input inputMode="numeric" pattern="[0-9]{6}" value={verificationCode} onInput={(event) => setVerificationCode(event.currentTarget.value)} /></label>
          <button class="ko-button ko-button--primary" type="button" disabled={!/^[0-9]{6}$/.test(verificationCode)} onClick={() => void verifyRecipient()}>Verify recipient</button></div>}
        <p class="ko-disabled-reason">Recipient verification sending is unavailable in local-only mode. A challenge may be prepared and captured, but this screen never sends email.</p>
      </section>
      <section class="ko-config-section"><h3>Schedule a report</h3><p>The schedule stores the immutable report reference and verified recipient IDs. It remains disabled in this deployment.</p>
        <fieldset class="ko-selection-list"><legend>Recipients</legend>{context?.recipientScope.map((recipient) => <label>
          <input type="checkbox" disabled={!verifiedRecipientIds.has(recipient.recipientId)} checked={selectedRecipients.includes(recipient.recipientId) && verifiedRecipientIds.has(recipient.recipientId)}
            onChange={(event) => setSelectedRecipients((current) => (event.currentTarget.checked ? [...current, recipient.recipientId] : current.filter((id) => id !== recipient.recipientId)).sort())} />
          {recipient.displayLabel} {verifiedRecipientIds.has(recipient.recipientId) ? "" : "(verify first)"}
        </label>)}</fieldset>
        <div class="ko-config-grid">
          <label class="ko-config-field">Recurrence<select value={schedulePreset} onChange={(event) => setSchedulePreset(event.currentTarget.value as typeof schedulePreset)}>
            <option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="45">Every 45 minutes</option><option value="60">Hourly</option>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom interval</option>
          </select><small>Saved recurrence is explicit; no cron is exposed.</small></label>
          <label class="ko-config-field">Schedule timezone<input list="ko-report-timezones" value={scheduleTimezone} maxLength={64} onInput={(event) => setScheduleTimezone(event.currentTarget.value)} />
            <datalist id="ko-report-timezones"><option value="UTC" /><option value={context?.timeZone ?? "UTC"} /><option value="America/New_York" /><option value="Europe/London" /><option value="Asia/Jerusalem" /></datalist>
            <small>IANA timezone; DST gaps and repeats follow the stored recurrence contract.</small></label>
          <label class="ko-config-field">Export format<select value={scheduleFormat} onChange={(event) => setScheduleFormat(event.currentTarget.value as typeof scheduleFormat)}><option value="csv">CSV link</option><option value="xlsx">XLSX link</option><option value="pdf">PDF link</option></select></label>
          {["daily", "weekly", "monthly"].includes(schedulePreset) && <label class="ko-config-field">Local time<input type="time" value={scheduleTime} onInput={(event) => setScheduleTime(event.currentTarget.value)} /></label>}
          {schedulePreset === "weekly" && <label class="ko-config-field">Weekday<select value={scheduleWeekday} onChange={(event) => setScheduleWeekday(Number(event.currentTarget.value))}>
            <option value={1}>Monday</option><option value={2}>Tuesday</option><option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option><option value={6}>Saturday</option><option value={7}>Sunday</option>
          </select></label>}
          {schedulePreset === "monthly" && <label class="ko-config-field">Day of month<input type="number" min={1} max={31} value={scheduleMonthDay} onInput={(event) => setScheduleMonthDay(Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)))} /><small>If the month is shorter, it runs on the last day.</small></label>}
          {schedulePreset === "custom" && <label class="ko-config-field">Interval in minutes<input type="number" min={1} max={1440} value={scheduleInterval} onInput={(event) => setScheduleInterval(Math.min(1440, Math.max(1, Number(event.currentTarget.value) || 1)))} /></label>}
        </div>
        <div class="ko-button-row"><button class="ko-button" type="button" disabled={!selectedReport || working} onClick={() => void loadSchedules()}>Load schedules</button>
          <button class="ko-button ko-button--primary" type="button" disabled={!selectedReport || !savedDefinitionCurrent || working || selectedRecipients.filter((id) => verifiedRecipientIds.has(id)).length === 0} onClick={() => void createDisabledSchedule()}>Save disabled schedule</button></div>
        {schedules.map((schedule) => <article class="ko-schedule-row"><div><strong>{text(schedule, "format").toUpperCase()} · {text(schedule, "enabled") === "true" ? "Enabled" : "Disabled"}</strong>
          <small>{recurrenceSentence(schedule.recurrence)}</small><small>{Array.isArray(schedule.recipient_ids) ? schedule.recipient_ids.length : 0} verified recipient(s) · report version {text(schedule, "report_row_version")}</small></div></article>)}
        <button class="ko-button" type="button" disabled title="Activation and email sending are outside this disabled deployment gate.">Enable schedule</button>
        <p class="ko-disabled-reason">Schedules remain disabled and sending is unavailable in local-only mode. No cron expression, secret, activation, or email sending is exposed here. The definition and recipients can be prepared now; sending remains blocked until the separately approved activation gate.</p>
      </section>
    </div>}
  </ShellFrame>;
}
