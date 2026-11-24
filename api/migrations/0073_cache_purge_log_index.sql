CREATE INDEX IF NOT EXISTS idx_cache_purge_log_status_action_created_at
    ON cache_purge_log (status, action, created_at);
