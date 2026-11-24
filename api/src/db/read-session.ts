export function renderReadDb(db: D1Database, bookmark: string | null | undefined): D1Database {
  try {
    // D1 bookmarks are opaque. Accept a single visible ASCII header value.
    const valid = typeof bookmark === "string" && /^[!-~]{1,256}$/.test(bookmark) && !bookmark.includes(",");
    const session = db.withSession?.(valid ? bookmark : "first-primary");
    if (!session) return db;

    return {
      prepare: query => session.prepare(query),
      batch: statements => session.batch(statements),
      exec: query => db.exec(query),
      dump: () => db.dump(),
      withSession: constraint => db.withSession(constraint),
    };
  } catch {
    return db;
  }
}
