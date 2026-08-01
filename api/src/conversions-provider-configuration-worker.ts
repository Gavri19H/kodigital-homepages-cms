import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
import { handleProviderConfigurationRequest } from "./admin/conversions/provider-configuration-authority";

export class ProviderConfigurationAuthority extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handleProviderConfigurationRequest(request, this.env);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleProviderConfigurationRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
