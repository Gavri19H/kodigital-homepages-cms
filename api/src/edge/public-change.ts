import type { Env } from "../env";
import type { PublicChange } from "./types";

export async function onPublicChange(env: Env, ctx: ExecutionContext | undefined, change: PublicChange): Promise<void> {
  return;
}
