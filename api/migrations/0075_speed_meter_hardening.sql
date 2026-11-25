-- Record the device class inferred from request headers.
ALTER TABLE vitals_samples ADD COLUMN device TEXT CHECK (device IN ('mobile','tablet','desktop'));

-- Group samples by client within a single site and UTC date.
ALTER TABLE vitals_samples ADD COLUMN client_key TEXT;

-- Count cache outcomes per site and UTC hour, with hour in Unix seconds at the start of the hour.
CREATE TABLE edge_hit_counts (site_id TEXT NOT NULL, hour INTEGER NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('HIT','MISS')), n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (site_id, hour, outcome));
