// Per-request D1 read cache for ONE admin page render.
//
// WHY. The quote editor page is assembled from nine internal API sub-requests
// (structure, sections, auctions, activation, frame, theme, templates, offers,
// routing-rules). They share one `env`, and each independently re-resolves the
// same rows. Measured on the real page: 57 D1 round trips for one render, with
// the same statements repeating 4-8 times over —
//   leadgen_quotes by public_id            x6
//   leadgen_funnels by quote_id            x6
//   active variants by funnel_id           x6
//   page/slot/section loaders              x6-8
// Locally that is invisible (in-process SQLite, ~0.2 ms a hop). In production
// every hop is a network round trip (~30-100 ms measured), so the page cost
// 8.5-8.9 s for ~50 ms of CPU, and the funnel board reloads the whole page after
// every add-section / add-page — the operator paid it on every action.
//
// WHAT. A read-through cache keyed by (method, sql, bound params, args) for the
// lifetime of ONE request. Identical reads collapse to a single hop, and the
// in-flight promise is shared so concurrent duplicates collapse too.
//
// WHY A CLASS AND NOT A PROXY. The first attempt wrapped the binding in a Proxy
// and broke the save path with "c.env.DB.batch is not a function": D1's native
// batch() will not accept wrapped statements, and a Proxy silently changes what
// `batch` resolves to. This implementation is explicit — every D1Database method
// is named, `batch()` UNWRAPS each statement back to the real one before
// delegating, and anything not overridden delegates verbatim.
//
// SAFETY
//  - Created per request and never shared: the caller hands it a fresh instance
//    alongside a shallow-copied `env`, so two requests (or two operators) can
//    never see each other's rows.
//  - Any write (run / batch / exec) CLEARS the cache, so a read issued after a
//    write in the same request still observes that write.
//  - Cached rows are structured-cloned on the way out, so a caller mutating a
//    row it received cannot corrupt what the next caller reads.
//  - A rejected read is never remembered.

type ReadMethod = "first" | "all" | "raw";

function cloneOut<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value; // non-cloneable payloads pass through untouched
  }
}

// Not `implements D1PreparedStatement`: that is an abstract CLASS whose `first`
// and `raw` are overloaded, so a structural match is impossible. The shape is
// still exactly D1's — the casts are at the boundaries only.
class CachedStatement {
  constructor(
    // The REAL statement. batch() reaches through this to hand D1 its own object.
    readonly inner: D1PreparedStatement,
    private readonly sql: string,
    private readonly params: readonly unknown[],
    private readonly cache: Map<string, Promise<unknown>>,
    private readonly clear: () => void,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new CachedStatement(this.inner.bind(...values), this.sql, values, this.cache, this.clear) as unknown as D1PreparedStatement;
  }

  private read<T>(method: ReadMethod, args: readonly unknown[], run: () => Promise<T>): Promise<T> {
    const key = `${method}|${this.sql}|${JSON.stringify(this.params)}|${JSON.stringify(args)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return (hit as Promise<T>).then((v) => cloneOut(v));
    const fresh = run();
    this.cache.set(key, fresh as Promise<unknown>);
    fresh.catch(() => this.cache.delete(key));
    return fresh.then((v) => cloneOut(v));
  }

  first<T = unknown>(colName?: string): Promise<T | null> {
    return this.read("first", [colName ?? null], () =>
      colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName),
    ) as Promise<T | null>;
  }

  all<T = unknown>(): Promise<D1Result<T>> {
    return this.read("all", [], () => this.inner.all<T>());
  }

  raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[]> {
    return this.read("raw", [options ?? null], () => (this.inner as unknown as { raw: (o?: unknown) => Promise<T[]> }).raw(options)) as Promise<T[]>;
  }

  run<T = unknown>(): Promise<D1Result<T>> {
    this.clear(); // a write invalidates every cached read in this request
    return this.inner.run<T>();
  }
}

class CachedD1 {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly inner: D1Database) {}

  private readonly clear = (): void => {
    this.cache.clear();
  };

  prepare(sql: string): D1PreparedStatement {
    return new CachedStatement(this.inner.prepare(sql), sql, [], this.cache, this.clear) as unknown as D1PreparedStatement;
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.clear(); // a batch may write
    // D1 rejects anything that is not one of ITS OWN statements — hand back the
    // real ones. (This is the exact failure the Proxy version shipped with.)
    return this.inner.batch<T>(statements.map((s) => (s instanceof CachedStatement ? (s.inner as D1PreparedStatement) : s)));
  }

  exec(query: string): Promise<D1ExecResult> {
    this.clear();
    return this.inner.exec(query);
  }

  dump(): Promise<ArrayBuffer> {
    return this.inner.dump();
  }

  withSession(constraintOrBookmark?: string): unknown {
    return (this.inner as unknown as { withSession?: (c?: string) => unknown }).withSession?.(constraintOrBookmark);
  }
}

// Returns a D1 facade whose identical reads cost ONE round trip per request.
// Create per request; never share the returned object between requests.
export function withRequestReadCache(db: D1Database): D1Database {
  return new CachedD1(db) as unknown as D1Database;
}
