import type { MiddlewareHandler } from "hono";
import { parseBoolean, type Env } from "../env";

export const accessAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (parseBoolean(c.env.DEV_BYPASS_AUTH)) {
    return next();
  }

  const jwtHeader = c.req.header("cf-access-jwt-assertion");
  const cookieHeader = c.req.header("cookie") ?? "";
  const hasCfAuthCookie = /(?:^|;\s*)CF_Authorization=/.test(cookieHeader);

  if (!jwtHeader && !hasCfAuthCookie) {
    return c.json(
      { error: "Unauthorized: missing Cloudflare Access credentials" },
      401,
    );
  }

  return next();
};
