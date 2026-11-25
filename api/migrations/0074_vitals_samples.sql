CREATE TABLE vitals_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    site_id TEXT NOT NULL,
    page_type TEXT NOT NULL CHECK (page_type IN ('home', 'article', 'category', 'tag', 'page', 'listicle', 'quote', 'other')),
    country TEXT,
    ttfb_ms REAL,
    fcp_ms REAL,
    lcp_ms REAL,
    inp_ms REAL,
    cls REAL,
    worker_version TEXT
);

CREATE INDEX idx_vitals_samples_site_created ON vitals_samples (site_id, created_at);
