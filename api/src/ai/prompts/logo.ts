// T5: Prompt module for logo image generation. The image model is not
// reliable at rendering literal brand text inside the mark, so the prompt
// explicitly forbids text rendering. The site name is not rendered; the
// logo is a typography-free symbol/mark. No transparent-background
// requirement — the background is treated as a flat solid color so the
// output is well-defined regardless of model capability.

export const PROMPT_VERSION = "logo:v1";

export interface BuildLogoPromptInput {
  site_id: string;
  vertical: string;
  brand_name?: string;
  palette?: string;
  // T24: operator-directed logo generation (LogoRequest from the admin AI-logo
  // panel). `description` is the operator's free-text direction (wire field
  // `prompt`), `style` is a stylistic keyword, and `colorScheme` overrides the
  // palette. Each refines the mark ONLY when present; absent, the prompt is
  // byte-identical to the undirected default so existing callers (provisioning)
  // and the deterministic prompt tests are unaffected.
  description?: string;
  style?: string;
  colorScheme?: string;
}

export function buildPrompt(input: BuildLogoPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const brand = (input.brand_name || "this brand").trim();
  const colorScheme = (input.colorScheme || "").trim();
  const palette = colorScheme || (input.palette || "neutral").trim();
  const style = (input.style || "").trim();
  const description = (input.description || "").trim();
  const directed: string[] = [];
  if (style) directed.push(`Style: ${style}.`);
  if (description) directed.push(`Operator direction: ${description}.`);
  return [
    `You are designing a symbolic logo mark for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Palette: ${palette}.`,
    `Site id: ${input.site_id}.`,
    ...directed,
    `Constraints:`,
    `- Symbolic mark only: a simple, geometric icon evocative of the vertical.`,
    `- No text rendering: do not draw letters, words, the brand name, glyphs, signage, or watermarks. The site name is not rendered.`,
    `- Square 1024x1024 composition; the mark is centered.`,
    `- Flat solid background color from the palette; no checker pattern; no gradient halos.`,
    `- Clean vector-style edges; high contrast between mark and background.`,
    `- No people, no logos of other organizations, no copyrighted characters.`,
    `Return an image only.`,
  ].join("\n");
}
