import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { transform } from "esbuild";

const assetDir = new URL("../src/public/assets/", import.meta.url);
const output = new URL("public-assets.generated.ts", assetDir);

async function loadSource(filename) {
  const ts = readFileSync(new URL(filename, assetDir), "utf8");
  const { code } = await transform(ts, { loader: "ts", format: "esm", sourcefile: filename });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

// Keep the layout's rollout hash and compute it over the exact response body.
function assetHash(content) {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (33 * hash + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

const { publicCss } = await loadSource("public-css.ts");
const { publicJs } = await loadSource("public-js.ts");
const { code: css } = await transform(publicCss, {
  loader: "css", minify: true,
  // Preserve rgba() colors for browsers that predate alpha-channel hex colors.
  supported: { "hex-rgba": false },
});
const { code: js } = await transform(publicJs, { loader: "js", minify: true, target: "es5" });

const generated = `// Generated from public-css.ts and public-js.ts by npm run build:public-assets.
export const cssHash = ${JSON.stringify(assetHash(css))};
export const jsHash = ${JSON.stringify(assetHash(js))};
export const minifiedPublicCss: string = ${JSON.stringify(css)};
export const minifiedPublicJs: string = ${JSON.stringify(js)};
`;

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) {
    throw new Error("public-assets.generated.ts is stale. Run npm run build:public-assets.");
  }
} else {
  writeFileSync(output, generated);
  for (const [name, raw, minified] of [["public.css", publicCss, css], ["public.js", publicJs, js]]) {
    console.log(`${name} bytes: ${Buffer.byteLength(raw)} raw, ${Buffer.byteLength(minified)} minified, ` +
      `${brotliCompressSync(minified).length} Brotli, ${gzipSync(minified).length} gzip`);
  }
}
