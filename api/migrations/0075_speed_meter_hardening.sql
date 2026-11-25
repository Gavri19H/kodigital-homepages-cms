-- Record the device class inferred from request headers.
ALTER TABLE vitals_samples ADD COLUMN device TEXT CHECK (device IN ('mobile','tablet','desktop'));

-- Group samples by client within a single site and UTC date.
ALTER TABLE vitals_samples ADD COLUMN client_key TEXT;

-- Record the gateway cache outcome reported by the visitor's navigation beacon.
ALTER TABLE vitals_samples ADD COLUMN edge TEXT CHECK (edge IN ('HIT','MISS'));
