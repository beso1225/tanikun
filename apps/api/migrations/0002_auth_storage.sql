-- Phase 5 auth storage. Existing users, documents, and changes keep their rows
-- and constraints. Dev users have NULL handles and remain session-ineligible.
ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE UNIQUE INDEX users_handle_unique ON users(handle) WHERE handle IS NOT NULL;

CREATE TABLE credentials (
  credential_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(credential_id) BETWEEN 2 AND 1364
    AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL CHECK (
    typeof(public_key) = 'blob' AND length(public_key) BETWEEN 1 AND 2048
  ),
  counter INTEGER NOT NULL CHECK (
    typeof(counter) = 'integer' AND counter BETWEEN 0 AND 9007199254740991
  ),
  backup_eligible INTEGER NOT NULL CHECK (backup_eligible IN (0, 1)),
  backup_state INTEGER NOT NULL CHECK (backup_state IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991
  ),
  last_used_at INTEGER NOT NULL CHECK (
    typeof(last_used_at) = 'integer' AND last_used_at BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT credential_backup_state CHECK (
    backup_eligible = 1 OR backup_state = 0
  )
);

CREATE INDEX credentials_user ON credentials(user_id);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 22 AND id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  challenge_digest BLOB NOT NULL CHECK (
    typeof(challenge_digest) = 'blob' AND length(challenge_digest) = 32
  ),
  binding_digest BLOB NOT NULL CHECK (
    typeof(binding_digest) = 'blob' AND length(binding_digest) = 32
  ),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('register', 'sign_in', 'add_credential', 'step_up')
  ),
  account_handle TEXT CHECK (
    account_handle IS NULL
    OR (
      length(account_handle) = 43
      AND account_handle NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  ),
  display_name TEXT CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 80
  ),
  user_id TEXT REFERENCES users(id),
  session_digest BLOB CHECK (
    session_digest IS NULL
    OR (typeof(session_digest) = 'blob' AND length(session_digest) = 32)
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991
  ),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at) = 'integer' AND expires_at BETWEEN 0 AND 9007199254740991
  ),
  consumed_at INTEGER CHECK (
    consumed_at IS NULL
    OR (
      typeof(consumed_at) = 'integer'
      AND consumed_at BETWEEN 0 AND 9007199254740991
    )
  ),
  CONSTRAINT challenge_purpose_binding CHECK (
    (
      purpose = 'register'
      AND account_handle IS NOT NULL
      AND display_name IS NOT NULL
      AND user_id IS NULL
      AND session_digest IS NULL
    )
    OR (
      purpose = 'sign_in'
      AND account_handle IS NULL
      AND display_name IS NULL
      AND user_id IS NULL
      AND session_digest IS NULL
    )
    OR (
      purpose IN ('add_credential', 'step_up')
      AND account_handle IS NULL
      AND display_name IS NULL
      AND user_id IS NOT NULL
      AND session_digest IS NOT NULL
    )
  ),
  CONSTRAINT challenge_lifetime CHECK (expires_at = created_at + 300000),
  CONSTRAINT challenge_consumed_range CHECK (
    consumed_at IS NULL
    OR (consumed_at >= created_at AND consumed_at < expires_at)
  )
);

CREATE UNIQUE INDEX challenges_registration_handle
  ON challenges(account_handle)
  WHERE purpose = 'register' AND account_handle IS NOT NULL;
CREATE INDEX challenges_binding_active
  ON challenges(binding_digest, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX challenges_expires ON challenges(expires_at);

CREATE TABLE sessions (
  digest BLOB PRIMARY KEY NOT NULL CHECK (
    typeof(digest) = 'blob' AND length(digest) = 32
  ),
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_digest BLOB NOT NULL CHECK (
    typeof(csrf_digest) = 'blob' AND length(csrf_digest) = 32
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991
  ),
  last_seen_at INTEGER NOT NULL CHECK (
    typeof(last_seen_at) = 'integer'
    AND last_seen_at BETWEEN 0 AND 9007199254740991
  ),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at) = 'integer' AND expires_at BETWEEN 0 AND 9007199254740991
  ),
  idle_expires_at INTEGER NOT NULL CHECK (
    typeof(idle_expires_at) = 'integer'
    AND idle_expires_at BETWEEN 0 AND 9007199254740991
  ),
  recent_auth_at INTEGER CHECK (
    recent_auth_at IS NULL
    OR (
      typeof(recent_auth_at) = 'integer'
      AND recent_auth_at BETWEEN 0 AND 9007199254740991
    )
  ),
  revoked_at INTEGER CHECK (
    revoked_at IS NULL
    OR (
      typeof(revoked_at) = 'integer'
      AND revoked_at BETWEEN 0 AND 9007199254740991
    )
  ),
  revoke_reason TEXT CHECK (
    revoke_reason IS NULL
    OR revoke_reason IN (
      'logout',
      'logout_all',
      'credential_removed',
      'sign_in_rotation'
    )
  ),
  CONSTRAINT session_absolute_lifetime CHECK (
    expires_at = created_at + 43200000
  ),
  CONSTRAINT session_idle_lifetime CHECK (
    idle_expires_at = last_seen_at + 1800000
  ),
  CONSTRAINT session_last_seen_range CHECK (last_seen_at >= created_at),
  CONSTRAINT session_revocation_state CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at, idle_expires_at);
