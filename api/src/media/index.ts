// Media module barrel: serve (public GET) + upload (admin POST) mounted as
// a single Hono sub-router so T12 can wire it with `app.route("/", media)`.

import { Hono } from "hono";
import type { Env } from "../env";
import serve, { MEDIA_CACHE_CONTROL } from "./serve";
import upload from "./upload";

const media = new Hono<{ Bindings: Env }>();
media.route("/", serve);
media.route("/", upload);

export default media;
export { MEDIA_CACHE_CONTROL };
