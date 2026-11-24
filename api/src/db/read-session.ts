export function timingNow(): number {
  try {
    return performance.now();
  } catch {
    return NaN;
  }
}

export function elapsedMs(start: number): number {
  const ms = timingNow() - start;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

// One collector per build. A round spans the union of overlapping D1 calls.
export class D1Timing {
  calls = 0;
  rounds = 0;
  primary = 0;
  replica = 0;
  readonly regions = new Set<string>();
  private active = 0;
  private roundStart = 0;
  private completedMs = 0;

  get wallMs(): number {
    return this.completedMs + (this.active ? elapsedMs(this.roundStart) : 0);
  }

  async measure<T>(execute: () => Promise<T>, observe?: (value: T) => void): Promise<T> {
    if (this.active === 0) {
      this.rounds++;
      this.roundStart = timingNow();
    }
    this.active++;
    this.calls++;
    let value: T;
    try {
      value = await execute();
    } finally {
      if (--this.active === 0) this.completedMs += elapsedMs(this.roundStart);
    }
    try {
      observe?.(value);
    } catch {
      // Optional D1 metadata must never change a query result.
    }
    return value;
  }

  readonly recordResult = (result: D1Response): void => {
    const meta = result?.meta;
    const primary = meta?.served_by_primary;
    if (primary === true) this.primary++;
    else if (primary === false) this.replica++;
    const region = meta?.served_by_region;
    if (typeof region === "string" && region.length) this.regions.add(region);
  };
}

class TimedStatement implements D1PreparedStatement {
  constructor(readonly inner: D1PreparedStatement, private readonly timing: D1Timing) {}

  bind(...values: unknown[]): TimedStatement {
    return new TimedStatement(this.inner.bind(...values), this.timing);
  }

  first<T>(column?: string): Promise<T | null> {
    return this.timing.measure(() => column === undefined ? this.inner.first<T>() : this.inner.first<T>(column));
  }

  all<T>(): Promise<D1Result<T>> {
    return this.timing.measure(() => this.inner.all<T>(), this.timing.recordResult);
  }

  run<T>(): Promise<D1Result<T>> {
    return this.timing.measure(() => this.inner.run<T>(), this.timing.recordResult);
  }

  raw<T>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T>(options?: { columnNames: true } | { columnNames?: false }): Promise<[string[], ...T[]] | T[]> {
    if (options?.columnNames) return this.timing.measure(() => this.inner.raw<T>(options));
    return this.timing.measure(() => this.inner.raw<T>(options));
  }
}

type ReadMethods = Pick<D1Database, "prepare" | "batch">;

function readMethods(source: ReadMethods, timing?: D1Timing): ReadMethods {
  return {
    prepare(query) {
      const statement = source.prepare(query);
      return timing ? new TimedStatement(statement, timing) : statement;
    },
    batch<T>(statements: D1PreparedStatement[]) {
      if (!timing) return source.batch<T>(statements);
      // A batch is one binding call and can return metadata for multiple statements.
      const native = statements.map(stmt => stmt instanceof TimedStatement ? stmt.inner : stmt);
      return timing.measure(() => source.batch<T>(native), results => results.forEach(timing.recordResult));
    },
  };
}

export function sessionReadDb(db: D1Database, session?: D1DatabaseSession, timing?: D1Timing): D1Database {
  if (!session && !timing) return db;
  return {
    ...readMethods(session ?? db, timing),
    exec: query => timing ? timing.measure(() => db.exec(query)) : db.exec(query),
    dump: () => timing ? timing.measure(() => db.dump()) : db.dump(),
    withSession(constraint) {
      const next = db.withSession(constraint);
      return timing ? { ...readMethods(next, timing), getBookmark: () => next.getBookmark() } : next;
    },
  };
}

export function renderReadDb(db: D1Database, bookmark: string | null | undefined, timing?: D1Timing): D1Database {
  let session: D1DatabaseSession | undefined;
  try {
    // D1 bookmarks are opaque. Accept a single visible ASCII header value.
    const valid = typeof bookmark === "string" && /^[!-~]{1,256}$/.test(bookmark) && !bookmark.includes(",");
    session = db.withSession?.(valid ? bookmark : "first-primary");
  } catch {
    // Continue rendering on the original binding when sessions are unavailable.
  }
  return sessionReadDb(db, session, timing);
}
