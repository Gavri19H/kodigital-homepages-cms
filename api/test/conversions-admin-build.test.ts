import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ASSET_MANIFEST_PATH,
  ADMIN_CSS_GZIP_BUDGET,
  assertCommittedBuild,
  buildConversionsAdminAssets,
  CONVERSIONS_ENTRY,
  CONVERSIONS_JS_GZIP_BUDGET,
  CONVERSIONS_OUTPUT_DIR,
  MAX_MANAGED_ASSET_FILES_PER_PRODUCT,
  readCommittedBuildSnapshot,
  REPORTING_ENTRY,
  REPORTING_JS_GZIP_BUDGET,
  REPORTING_OUTPUT_DIR,
  writeBuiltProduct,
  writeConversionsAdminBuild,
  type ConversionsAdminBuild,
  type CommittedBuildSnapshot,
} from "../scripts/build-conversions-admin";
import { ADMIN_ASSET_MANIFEST } from "../src/admin/conversions/asset-manifest.generated";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assetPath(outputDirectory: string, fileName: string): string {
  return resolve(outputDirectory, fileName);
}

function addSnapshotEntry(
  snapshot: CommittedBuildSnapshot,
  outputDirectory: string,
  fileName: string,
  content: Buffer | null,
  kind: CommittedBuildSnapshot["entryKinds"][string] = "regular_file",
): CommittedBuildSnapshot {
  const path = assetPath(outputDirectory, fileName);
  return {
    ...snapshot,
    directoryEntries: {
      ...snapshot.directoryEntries,
      [outputDirectory]: [...(snapshot.directoryEntries[outputDirectory] ?? []), fileName].sort(),
    },
    entryKinds: { ...snapshot.entryKinds, [path]: kind },
    files: { ...snapshot.files, [path]: content },
  };
}

function replaceSnapshotBytes(
  snapshot: CommittedBuildSnapshot,
  outputDirectory: string,
  fileName: string,
  content: Buffer,
): CommittedBuildSnapshot {
  const path = assetPath(outputDirectory, fileName);
  return { ...snapshot, files: { ...snapshot.files, [path]: content } };
}

function withoutSnapshotEntry(
  snapshot: CommittedBuildSnapshot,
  outputDirectory: string,
  fileName: string,
): CommittedBuildSnapshot {
  const path = assetPath(outputDirectory, fileName);
  return {
    ...snapshot,
    directoryEntries: {
      ...snapshot.directoryEntries,
      [outputDirectory]: (snapshot.directoryEntries[outputDirectory] ?? []).filter(
        (entry) => entry !== fileName,
      ),
    },
    entryKinds: Object.fromEntries(
      Object.entries(snapshot.entryKinds).filter(([entryPath]) => entryPath !== path),
    ),
    files: Object.fromEntries(Object.entries(snapshot.files).filter(([entryPath]) => entryPath !== path)),
  };
}

function deterministicNoise(length: number): Buffer {
  const output = Buffer.allocUnsafe(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < output.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = state & 0xff;
  }
  return output;
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  function visit(path: string, relative: string): void {
    const status = lstatSync(path);
    hash.update(`${relative}\0${status.mode}\0`);
    if (status.isSymbolicLink()) {
      hash.update(`link\0${readlinkSync(path)}\0`);
      return;
    }
    if (status.isFile()) {
      hash.update("file\0");
      hash.update(readFileSync(path));
      hash.update("\0");
      return;
    }
    if (status.isDirectory()) {
      hash.update("directory\0");
      for (const entry of readdirSync(path).sort()) visit(resolve(path, entry), `${relative}/${entry}`);
      return;
    }
    hash.update("other\0");
  }
  visit(root, ".");
  return hash.digest("hex");
}

function createFifo(path: string): void {
  const result = spawnSync("/usr/bin/mkfifo", [path], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`mkfifo failed for ${path}: ${result.stderr || result.error?.message || "unknown"}`);
  }
}

function createWriteGraph(built: ConversionsAdminBuild, label: string) {
  const root = mkdtempSync(resolve(realpathSync(tmpdir()), `ko-admin-entrypoint-${label}-`));
  const conversions = resolve(root, "conversions");
  const reporting = resolve(root, "reporting");
  const manifestDirectory = resolve(root, "manifest");
  const manifestPath = resolve(manifestDirectory, "asset-manifest.generated.ts");
  mkdirSync(conversions);
  mkdirSync(reporting);
  mkdirSync(manifestDirectory);
  writeFileSync(manifestPath, "existing manifest sentinel\n", "utf8");
  return {
    root,
    conversions,
    reporting,
    manifestDirectory,
    manifestPath,
    build: {
      ...built,
      conversions: { ...built.conversions, outputDirectory: conversions },
      reporting: { ...built.reporting, outputDirectory: reporting },
    },
  };
}

describe("Conversions and Reporting Preact build contract", () => {
  it("rebuilds both products deterministically and byte-matches the exact committed topology", async () => {
    const first = await buildConversionsAdminAssets();
    const second = await buildConversionsAdminAssets();
    expect(second).toEqual(first);
    expect(() => assertCommittedBuild(first)).not.toThrow();

    expect(ADMIN_ASSET_MANIFEST_PATH).toMatch(/src\/admin\/conversions\/asset-manifest\.generated\.ts$/);
    expect(CONVERSIONS_OUTPUT_DIR).toMatch(/public\/assets\/admin\/conversions$/);
    expect(REPORTING_OUTPUT_DIR).toMatch(/public\/assets\/admin\/reporting$/);
    expect(first.manifestSource).toBe(readFileSync(ADMIN_ASSET_MANIFEST_PATH, "utf8"));
    expect(first.manifestSource).not.toContain("content:");

    for (const [product, manifest, jsBudget] of [
      [first.conversions, ADMIN_ASSET_MANIFEST.conversions, CONVERSIONS_JS_GZIP_BUDGET],
      [first.reporting, ADMIN_ASSET_MANIFEST.reporting, REPORTING_JS_GZIP_BUDGET],
    ] as const) {
      expect(product.js.fileName).toMatch(new RegExp(`^${product.name}\\.[0-9a-f]{16}\\.js$`));
      expect(product.css.fileName).toMatch(new RegExp(`^${product.name}\\.[0-9a-f]{16}\\.css$`));
      expect(product.js.url).toBe(`/assets/admin/${product.name}/${product.js.fileName}`);
      expect(product.css.url).toBe(`/assets/admin/${product.name}/${product.css.fileName}`);
      expect(product.js.sha256).toBe(manifest.js.sha256);
      expect(product.css.sha256).toBe(manifest.css.sha256);
      expect(product.js.gzipBytes).toBeLessThanOrEqual(jsBudget);
      expect(product.css.gzipBytes).toBeLessThanOrEqual(ADMIN_CSS_GZIP_BUDGET);
      expect(readFileSync(assetPath(product.outputDirectory, product.js.fileName), "utf8")).toBe(product.js.content);
      expect(readFileSync(assetPath(product.outputDirectory, product.css.fileName), "utf8")).toBe(product.css.content);
      expect(sha256(product.js.content)).toBe(product.js.sha256);
      expect(sha256(product.css.content)).toBe(product.css.sha256);
    }
  });

  it("accepts valid retained content-addressed regular files without weakening the active manifest", async () => {
    const built = await buildConversionsAdminAssets();
    const committed = readCommittedBuildSnapshot(built);
    const retainedBytes = Buffer.from("console.log('retained conversion asset');\n", "utf8");
    const retainedName = `conversions.${sha256(retainedBytes).slice(0, 16)}.js`;
    const retained = addSnapshotEntry(
      committed,
      built.conversions.outputDirectory,
      retainedName,
      retainedBytes,
    );
    expect(() => assertCommittedBuild(built, retained)).not.toThrow();

    expect(Object.keys(ADMIN_ASSET_MANIFEST).sort()).toEqual(["conversions", "reporting"]);
    for (const productManifest of Object.values(ADMIN_ASSET_MANIFEST)) {
      expect(Object.keys(productManifest).sort()).toEqual(["css", "js"]);
      for (const asset of Object.values(productManifest)) {
        expect(Object.keys(asset).sort()).toEqual([
          "bytes",
          "contentType",
          "etag",
          "fileName",
          "gzipBytes",
          "sha256",
          "url",
        ]);
      }
    }
  });

  it("rejects a managed output directory or ancestor symlink before check-mode reads or write-mode output", async () => {
    const built = await buildConversionsAdminAssets();
    const root = mkdtempSync(resolve(realpathSync(tmpdir()), "ko-admin-boundary-"));
    const target = resolve(root, "target");
    const directLink = resolve(root, "direct-link");
    const ancestorTarget = resolve(root, "ancestor-target");
    const ancestorLink = resolve(root, "ancestor-link");
    const safeReporting = resolve(root, "reporting");
    mkdirSync(target);
    mkdirSync(ancestorTarget);
    mkdirSync(resolve(ancestorTarget, "nested"));
    mkdirSync(safeReporting);
    symlinkSync(target, directLink, "dir");
    symlinkSync(ancestorTarget, ancestorLink, "dir");

    for (const outputDirectory of [directLink, resolve(ancestorLink, "nested")]) {
      const hostileBuild = {
        ...built,
        conversions: { ...built.conversions, outputDirectory },
        reporting: { ...built.reporting, outputDirectory: safeReporting },
      };
      expect(() => readCommittedBuildSnapshot(hostileBuild)).toThrow("is a symbolic link");
      expect(() => writeBuiltProduct(hostileBuild.conversions)).toThrow("is a symbolic link");
    }
    expect(readdirSync(target)).toEqual([]);
    expect(readdirSync(resolve(ancestorTarget, "nested"))).toEqual([]);
  });

  it("rejects hostile symlink and non-file children before reading or overwriting managed assets", async () => {
    const built = await buildConversionsAdminAssets();
    const root = mkdtempSync(resolve(realpathSync(tmpdir()), "ko-admin-children-"));
    for (const kind of ["symlink", "directory", "other"] as const) {
      const conversions = resolve(root, `${kind}-conversions`);
      const reporting = resolve(root, `${kind}-reporting`);
      mkdirSync(conversions);
      mkdirSync(reporting);
      const hostile = resolve(conversions, `conversions.${"a".repeat(16)}.js`);
      if (kind === "symlink") {
        const target = resolve(root, `${kind}-target.js`);
        writeFileSync(target, "unchanged", "utf8");
        symlinkSync(target, hostile, "file");
      } else if (kind === "directory") {
        mkdirSync(hostile);
      } else {
        const blocker = resolve(root, `${kind}-ancestor-blocker`);
        writeFileSync(blocker, "not a directory", "utf8");
        const blockedProduct = { ...built.conversions, outputDirectory: resolve(blocker, "nested") };
        expect(() => writeBuiltProduct(blockedProduct)).toThrow("is not a directory");
        continue;
      }
      const hostileBuild = {
        ...built,
        conversions: { ...built.conversions, outputDirectory: conversions },
        reporting: { ...built.reporting, outputDirectory: reporting },
      };
      expect(() => readCommittedBuildSnapshot(hostileBuild)).toThrow("is not a regular file");
      expect(() => writeBuiltProduct(hostileBuild.conversions)).toThrow("is not a regular file");
    }
  });

  it("whole-build entrypoint preflights every product and manifest boundary before its first byte", async () => {
    const built = await buildConversionsAdminAssets();
    const cases: Array<{
      name: string;
      configure: (graph: ReturnType<typeof createWriteGraph>) => {
        build?: ConversionsAdminBuild;
        manifestPath?: string;
      };
    }> = [
      { name: "conversions-output-symlink", configure(graph) {
        const target = resolve(graph.root, "conversions-output-target");
        const link = resolve(graph.root, "conversions-output-link");
        mkdirSync(target);
        symlinkSync(target, link, "dir");
        return { build: { ...graph.build, conversions: { ...graph.build.conversions, outputDirectory: link } } };
      } },
      { name: "reporting-output-symlink", configure(graph) {
        const target = resolve(graph.root, "reporting-output-target");
        const link = resolve(graph.root, "reporting-output-link");
        mkdirSync(target);
        symlinkSync(target, link, "dir");
        return { build: { ...graph.build, reporting: { ...graph.build.reporting, outputDirectory: link } } };
      } },
      { name: "conversions-output-nondirectory", configure(graph) {
        const blocker = resolve(graph.root, "conversions-output-file");
        writeFileSync(blocker, "blocker", "utf8");
        return { build: { ...graph.build, conversions: { ...graph.build.conversions, outputDirectory: blocker } } };
      } },
      { name: "reporting-output-nondirectory", configure(graph) {
        const blocker = resolve(graph.root, "reporting-output-file");
        writeFileSync(blocker, "blocker", "utf8");
        return { build: { ...graph.build, reporting: { ...graph.build.reporting, outputDirectory: blocker } } };
      } },
      { name: "conversions-ancestor-symlink", configure(graph) {
        const target = resolve(graph.root, "conversions-ancestor-target");
        const link = resolve(graph.root, "conversions-ancestor-link");
        mkdirSync(target);
        mkdirSync(resolve(target, "nested"));
        symlinkSync(target, link, "dir");
        return { build: { ...graph.build, conversions: {
          ...graph.build.conversions, outputDirectory: resolve(link, "nested"),
        } } };
      } },
      { name: "reporting-ancestor-symlink", configure(graph) {
        const target = resolve(graph.root, "reporting-ancestor-target");
        const link = resolve(graph.root, "reporting-ancestor-link");
        mkdirSync(target);
        mkdirSync(resolve(target, "nested"));
        symlinkSync(target, link, "dir");
        return { build: { ...graph.build, reporting: {
          ...graph.build.reporting, outputDirectory: resolve(link, "nested"),
        } } };
      } },
      { name: "conversions-ancestor-nondirectory", configure(graph) {
        const blocker = resolve(graph.root, "conversions-ancestor-file");
        writeFileSync(blocker, "blocker", "utf8");
        return { build: { ...graph.build, conversions: {
          ...graph.build.conversions, outputDirectory: resolve(blocker, "nested"),
        } } };
      } },
      { name: "reporting-ancestor-nondirectory", configure(graph) {
        const blocker = resolve(graph.root, "reporting-ancestor-file");
        writeFileSync(blocker, "blocker", "utf8");
        return { build: { ...graph.build, reporting: {
          ...graph.build.reporting, outputDirectory: resolve(blocker, "nested"),
        } } };
      } },
      { name: "conversions-child-symlink", configure(graph) {
        const target = resolve(graph.root, "conversions-child-target.js");
        writeFileSync(target, "target sentinel", "utf8");
        symlinkSync(target, resolve(graph.conversions, "hostile-child.js"), "file");
        return {};
      } },
      { name: "reporting-child-symlink", configure(graph) {
        const target = resolve(graph.root, "reporting-child-target.js");
        writeFileSync(target, "target sentinel", "utf8");
        symlinkSync(target, resolve(graph.reporting, "hostile-child.js"), "file");
        return {};
      } },
      { name: "conversions-child-directory", configure(graph) {
        mkdirSync(resolve(graph.conversions, "hostile-child"));
        return {};
      } },
      { name: "reporting-child-directory", configure(graph) {
        mkdirSync(resolve(graph.reporting, "hostile-child"));
        return {};
      } },
      { name: "conversions-child-other", configure(graph) {
        createFifo(resolve(graph.conversions, "hostile-child"));
        return {};
      } },
      { name: "reporting-child-other", configure(graph) {
        createFifo(resolve(graph.reporting, "hostile-child"));
        return {};
      } },
      { name: "manifest-symlink", configure(graph) {
        const target = resolve(graph.root, "manifest-target.ts");
        const link = resolve(graph.root, "manifest-link.ts");
        writeFileSync(target, "manifest target sentinel", "utf8");
        symlinkSync(target, link, "file");
        return { manifestPath: link };
      } },
      { name: "manifest-directory", configure(graph) {
        const directory = resolve(graph.root, "manifest-as-directory");
        mkdirSync(directory);
        return { manifestPath: directory };
      } },
      { name: "manifest-ancestor-symlink", configure(graph) {
        const target = resolve(graph.root, "manifest-ancestor-target");
        const link = resolve(graph.root, "manifest-ancestor-link");
        mkdirSync(target);
        writeFileSync(resolve(target, "manifest.ts"), "manifest target sentinel", "utf8");
        symlinkSync(target, link, "dir");
        return { manifestPath: resolve(link, "manifest.ts") };
      } },
      { name: "manifest-ancestor-nondirectory", configure(graph) {
        const blocker = resolve(graph.root, "manifest-ancestor-file");
        writeFileSync(blocker, "blocker", "utf8");
        return { manifestPath: resolve(blocker, "manifest.ts") };
      } },
    ];
    for (const productName of ["conversions", "reporting"] as const) {
      for (const assetName of ["js", "css"] as const) {
        for (const kind of ["symlink", "directory", "other"] as const) {
          cases.push({
            name: `${productName}-active-${assetName}-${kind}`,
            configure(graph) {
              const product = graph.build[productName];
              const activePath = resolve(product.outputDirectory, product[assetName].fileName);
              if (kind === "symlink") {
                const target = resolve(graph.root, `${productName}-${assetName}-active-target`);
                writeFileSync(target, "active target sentinel", "utf8");
                symlinkSync(target, activePath, "file");
              } else if (kind === "directory") {
                mkdirSync(activePath);
              } else {
                createFifo(activePath);
              }
              return {};
            },
          });
        }
      }
    }
    expect(cases).toHaveLength(30);
    for (const testCase of cases) {
      const graph = createWriteGraph(built, testCase.name);
      const configured = testCase.configure(graph);
      const candidate = configured.build ?? graph.build;
      const manifestPath = configured.manifestPath ?? graph.manifestPath;
      const before = treeDigest(graph.root);
      expect(() => writeConversionsAdminBuild(candidate, manifestPath), testCase.name).toThrow();
      expect(treeDigest(graph.root), testCase.name).toBe(before);
    }
  });

  it("whole-build entrypoint writes the complete safe graph deterministically", async () => {
    const built = await buildConversionsAdminAssets();
    const graph = createWriteGraph(built, "deterministic");
    writeConversionsAdminBuild(graph.build, graph.manifestPath);
    expect(readFileSync(resolve(graph.conversions, built.conversions.js.fileName), "utf8")).toBe(built.conversions.js.content);
    expect(readFileSync(resolve(graph.conversions, built.conversions.css.fileName), "utf8")).toBe(built.conversions.css.content);
    expect(readFileSync(resolve(graph.reporting, built.reporting.js.fileName), "utf8")).toBe(built.reporting.js.content);
    expect(readFileSync(resolve(graph.reporting, built.reporting.css.fileName), "utf8")).toBe(built.reporting.css.content);
    expect(readFileSync(graph.manifestPath, "utf8")).toBe(built.manifestSource);
    const first = treeDigest(graph.root);
    writeConversionsAdminBuild(graph.build, graph.manifestPath);
    expect(treeDigest(graph.root)).toBe(first);
  });

  it("rejects stale manifest, missing/tampered/oversized active outputs and retained substitution", async () => {
    const built = await buildConversionsAdminAssets();
    const committed = readCommittedBuildSnapshot(built);
    const staleManifest: CommittedBuildSnapshot = {
      ...committed,
      manifestSource: committed.manifestSource?.slice(0, -1) ?? null,
    };
    expect(() => assertCommittedBuild(built, staleManifest)).toThrow("committed admin asset manifest is stale");

    const conversionJsPath = assetPath(built.conversions.outputDirectory, built.conversions.js.fileName);
    const staleBytes = replaceSnapshotBytes(
      committed,
      built.conversions.outputDirectory,
      built.conversions.js.fileName,
      Buffer.concat([committed.files[conversionJsPath] ?? Buffer.alloc(0), Buffer.from("\n")]),
    );
    expect(() => assertCommittedBuild(built, staleBytes)).toThrow("committed conversions");

    const missing = withoutSnapshotEntry(
      committed,
      built.conversions.outputDirectory,
      built.conversions.js.fileName,
    );
    expect(() => assertCommittedBuild(built, missing)).toThrow("is missing");

    const retainedBytes = Buffer.from("console.log('not the active output');\n", "utf8");
    const retainedName = `conversions.${sha256(retainedBytes).slice(0, 16)}.js`;
    const retainedOnly = addSnapshotEntry(missing, built.conversions.outputDirectory, retainedName, retainedBytes);
    expect(() => assertCommittedBuild(built, retainedOnly)).toThrow("is missing");

    const oversized = replaceSnapshotBytes(
      committed,
      built.conversions.outputDirectory,
      built.conversions.js.fileName,
      deterministicNoise(CONVERSIONS_JS_GZIP_BUDGET + 64 * 1024),
    );
    expect(() => assertCommittedBuild(built, oversized)).toThrow("exceeds");
  });

  it("rejects tampered hashes, unhashed/wrong-kind names, links and non-file retained entries", async () => {
    const built = await buildConversionsAdminAssets();
    const committed = readCommittedBuildSnapshot(built);
    const retainedBytes = Buffer.from("console.log('valid retained output');\n", "utf8");
    const retainedName = `reporting.${sha256(retainedBytes).slice(0, 16)}.js`;
    const valid = addSnapshotEntry(
      committed,
      built.reporting.outputDirectory,
      retainedName,
      retainedBytes,
    );
    expect(() => assertCommittedBuild(built, valid)).not.toThrow();

    const tampered = replaceSnapshotBytes(
      valid,
      built.reporting.outputDirectory,
      retainedName,
      Buffer.from("console.log('tampered retained output');\n", "utf8"),
    );
    expect(() => assertCommittedBuild(built, tampered)).toThrow("content hash does not match");

    for (const wrongName of [
      "reporting.js",
      `reporting.${sha256(retainedBytes).slice(0, 16)}.mjs`,
      `conversions.${sha256(retainedBytes).slice(0, 16)}.js`,
    ]) {
      const wrong = addSnapshotEntry(
        committed,
        built.reporting.outputDirectory,
        wrongName,
        retainedBytes,
      );
      expect(() => assertCommittedBuild(built, wrong)).toThrow("invalid content-addressed filename");
    }

    for (const kind of ["symlink", "directory", "other"] as const) {
      const invalidKind = addSnapshotEntry(
        committed,
        built.reporting.outputDirectory,
        retainedName,
        null,
        kind,
      );
      expect(() => assertCommittedBuild(built, invalidKind)).toThrow("is not a regular file");
    }

    for (const [product, extension, budget] of [
      [built.conversions, "css", ADMIN_CSS_GZIP_BUDGET],
      [built.reporting, "js", REPORTING_JS_GZIP_BUDGET],
    ] as const) {
      const oversizedBytes = deterministicNoise(budget + 64 * 1024);
      const oversizedName = `${product.name}.${sha256(oversizedBytes).slice(0, 16)}.${extension}`;
      const oversizedRetained = addSnapshotEntry(
        committed,
        product.outputDirectory,
        oversizedName,
        oversizedBytes,
      );
      expect(() => assertCommittedBuild(built, oversizedRetained)).toThrow("exceeds");
    }
  });

  it("bounds managed-directory work and contains no asset cleanup primitive", async () => {
    const built = await buildConversionsAdminAssets();
    const committed = readCommittedBuildSnapshot(built);
    const tooMany: CommittedBuildSnapshot = {
      ...committed,
      directoryEntries: {
        ...committed.directoryEntries,
        [built.conversions.outputDirectory]: Array.from(
          { length: MAX_MANAGED_ASSET_FILES_PER_PRODUCT + 1 },
          (_, index) => `entry-${index}`,
        ),
      },
    };
    expect(() => assertCommittedBuild(built, tooMany)).toThrow("bounded entry limit");

    const duplicate: CommittedBuildSnapshot = {
      ...committed,
      directoryEntries: {
        ...committed.directoryEntries,
        [built.reporting.outputDirectory]: [
          ...(committed.directoryEntries[built.reporting.outputDirectory] ?? []),
          built.reporting.js.fileName,
        ],
      },
    };
    expect(() => assertCommittedBuild(built, duplicate)).toThrow("duplicate entries");

    const builderSource = readFileSync(new URL("../scripts/build-conversions-admin.ts", import.meta.url), "utf8");
    expect(builderSource).not.toMatch(/\b(?:unlink|rm|rmdir|rename)Sync\b/);
  });

  it("uses distinct TSX source roots with one shared safe shell", async () => {
    const conversionsEntry = readFileSync(CONVERSIONS_ENTRY, "utf8");
    const reportingEntry = readFileSync(REPORTING_ENTRY, "utf8");
    const shell = readFileSync(new URL("../src/admin/conversions/app/shell.tsx", import.meta.url), "utf8");
    expect(conversionsEntry).toContain('document.getElementById("ko-conversions-root")');
    expect(reportingEntry).toContain('document.getElementById("ko-reporting-root")');
    expect(conversionsEntry).toContain('import { render } from "preact"');
    expect(reportingEntry).toContain('import { render } from "preact"');
    for (const label of ["Flows", "Connections", "Activity", "Controls", "Reports"]) {
      expect(shell).toContain(`label: "${label}"`);
      expect(ADMIN_ASSET_MANIFEST.conversions.js.bytes).toBeGreaterThan(0);
      expect(ADMIN_ASSET_MANIFEST.reporting.js.bytes).toBeGreaterThan(0);
    }
    for (const state of ["loading", "empty", "dependency_unavailable", "error"]) {
      expect(shell).toContain(state);
    }
    expect(shell).toContain("data-bootstrap-warning");
    expect(shell).toContain('aria-live="polite"');
    expect(shell).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=|\beval\s*\(|\bnew\s+Function\b/);
  });

  it("pins 320px-safe CSS and a high-contrast forced-colors-aware focus indicator", async () => {
    const built = await buildConversionsAdminAssets();
    for (const css of [built.conversions.css.content, built.reporting.css.content]) {
      expect(css).toContain(":focus-visible");
      expect(css).toContain("outline:3px solid #111827");
      expect(css).toContain("box-shadow:0 0 0 5px #fff");
      expect(css).toContain("forced-colors:active");
      expect(css).toContain("CanvasText");
      expect(css).toContain("min-width:0");
      expect(css).toContain("max-width:480px");
      expect(css).toContain("max-width:768px");
      expect(css).toContain("overflow-wrap:anywhere");
      expect(css).not.toMatch(/(?:^|[;{])width:\s*(?:[4-9]\d\d|\d{4,})px/);
      expect(css).toMatch(/\.ko-modal-backdrop\{position:fixed;inset:0/);
      expect(css.match(/position:fixed/g)).toHaveLength(1);
    }
  });

  it("pins the Worker-first static-assets binding and the per-environment Conversions flags", () => {
    const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    expect(config).toMatch(/\[assets\]\s+directory\s*=\s*"\.\/public"\s+binding\s*=\s*"ADMIN_ASSETS"\s+run_worker_first\s*=\s*true/);
    // Was a bare `3 x "false"` count. PRODUCTION IS NOW ENABLED ON PURPOSE: a CI
    // deploy overwrites the Dashboard, and the live production version
    // 4f2db4f9-0c6f-469a-9a85-701f78691e9d serves CONVERSIONS_UI_ENABLED="true" /
    // CONVERSIONS_PROXY_ENABLED="true" — shipping "false" would silently turn the
    // Conversions product off. Local [vars] and staging stay disabled because
    // [env.staging] declares `services = []`, i.e. no CONVERSIONS_CORE binding to
    // proxy to. Strengthened, not relaxed: this now pins WHICH block holds WHICH
    // value for BOTH flags instead of counting one flag's occurrences.
    expect(config.match(/CONVERSIONS_UI_ENABLED\s*=\s*"false"/g)).toHaveLength(2);
    expect(config.match(/CONVERSIONS_PROXY_ENABLED\s*=\s*"false"/g)).toHaveLength(2);
    const staging = config.slice(config.indexOf("[env.staging.vars]"), config.indexOf("[env.production]"));
    expect(staging).toMatch(/CONVERSIONS_UI_ENABLED\s*=\s*"false"/);
    expect(staging).toMatch(/CONVERSIONS_PROXY_ENABLED\s*=\s*"false"/);
    const production = config.slice(config.indexOf("[env.production.vars]"));
    expect(production).toMatch(/CONVERSIONS_UI_ENABLED\s*=\s*"true"/);
    expect(production).toMatch(/CONVERSIONS_PROXY_ENABLED\s*=\s*"true"/);
    expect(production).toMatch(/\[\[env\.production\.services\]\]\s+binding\s*=\s*"CONVERSIONS_CORE"\s+service\s*=\s*"kodigital-conversions-core"/);
  });
});
