-- Phase 5 D1 fixed-window abuse counters. Bucket keys are keyed HMAC-SHA-256
-- digests derived from AUTH_RATE_LIMIT_KEY and a domain-separated policy/scope
-- value. No raw address, credential, token, session, challenge, or PRF value
-- can be stored in this table.
CREATE TABLE auth_rate_limit_counters (
  bucket_key TEXT NOT NULL CHECK (
    length(bucket_key) = 43
    AND bucket_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  window_start INTEGER NOT NULL CHECK (
    typeof(window_start) = 'integer'
    AND window_start BETWEEN 0 AND 9007199254740991
  ),
  count INTEGER NOT NULL CHECK (
    typeof(count) = 'integer'
    AND count BETWEEN 1 AND 9007199254740991
  ),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at) = 'integer'
    AND expires_at BETWEEN 0 AND 9007199254740991
  ),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX auth_rate_limit_counters_expires
  ON auth_rate_limit_counters(expires_at);
