import type { Env } from "../env";

const hostnameLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function perfstageRequest(request: Request, env: Env): Request {
  if (env.PERFSTAGE !== "true") return request;
  const host = request.headers.get("x-perfstage-host")?.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || !host.split(".").every(label => hostnameLabel.test(label))) return request;

  const url = new URL(request.url);
  url.hostname = host;
  // URL setters can silently reject a hostname or reinterpret a numeric label as an IPv4 address.
  if (url.hostname !== host) return request;
  url.port = "";
  const tenant = new Request(url, request);
  tenant.headers.delete("x-perfstage-host");
  if (tenant.cf === undefined && request.cf !== undefined) tenant.cf = request.cf;
  return tenant;
}

function writesDisabled(): never {
  throw new Error("perfstage: R2 writes disabled");
}

const rejectWrite = async (): Promise<never> => writesDisabled();

export function perfstageEnv(env: Env): Env {
  if (env.PERFSTAGE !== "true") return env;
  const bucket = env.MEDIA;
  return {
    ...env,
    MEDIA: {
      get: (key, options) => bucket.get(key, options),
      head: key => bucket.head(key),
      list: options => bucket.list(options),
      put: rejectWrite,
      delete: rejectWrite,
      createMultipartUpload: rejectWrite,
      // The R2 API returns this handle synchronously.
      resumeMultipartUpload: writesDisabled,
    },
  };
}
