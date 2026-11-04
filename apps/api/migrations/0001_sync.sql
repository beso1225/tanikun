CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  last_seq INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sync_sequence_range CHECK (
      typeof(last_seq) = 'integer' AND last_seq BETWEEN 0 AND 9007199254740991
    ),
  created_at INTEGER NOT NULL
);

CREATE TABLE changes (
  document_id TEXT NOT NULL REFERENCES documents(id),
  seq INTEGER NOT NULL CHECK (
    typeof(seq) = 'integer' AND seq BETWEEN 1 AND 9007199254740991
  ),
  change_id TEXT NOT NULL CHECK (
    length(change_id) = 64 AND change_id NOT GLOB '*[^0-9a-f]*'
  ),
  payload BLOB NOT NULL CHECK (
    typeof(payload) = 'blob' AND length(payload) BETWEEN 1 AND 262144
  ),
  envelope_version INTEGER NOT NULL CHECK (envelope_version = 1),
  crypto_alg TEXT NOT NULL CHECK (crypto_alg IN ('none', 'AES-256-GCM')),
  key_version INTEGER NOT NULL CHECK (
    typeof(key_version) = 'integer' AND key_version BETWEEN 0 AND 9007199254740991
  ),
  nonce BLOB,
  envelope BLOB NOT NULL CHECK (typeof(envelope) = 'blob'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (document_id, seq),
  UNIQUE (document_id, change_id),
  CHECK (
    (crypto_alg = 'none' AND key_version = 0 AND nonce IS NULL)
    OR (crypto_alg = 'AES-256-GCM' AND key_version > 0
      AND typeof(nonce) = 'blob' AND length(nonce) = 12 AND length(payload) >= 17)
  )
);
