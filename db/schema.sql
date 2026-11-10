-- Applied on server boot and by the seed. Money is stored as decimal TEXT.
CREATE TABLE IF NOT EXISTS signing_keys (
  key_id TEXT PRIMARY KEY,
  public_key TEXT,
  private_key TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  owner TEXT,
  label TEXT,
  status TEXT,
  current_version INTEGER,
  created_at TEXT,
  updated_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS mandate_versions (
  mandate_id TEXT,
  version INTEGER,
  limits TEXT,
  created_at TEXT,
  payload_hash TEXT,
  signature TEXT,
  key_id TEXT,
  PRIMARY KEY (mandate_id, version)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  sku TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  price_value TEXT,
  currency_code TEXT,
  merchant TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  mandate_id TEXT,
  mandate_version INTEGER,
  sku TEXT,
  item_name TEXT,
  category TEXT,
  amount_value TEXT,
  currency_code TEXT,
  status TEXT,
  within_mandate INTEGER,
  breaches TEXT,
  demo_rogue INTEGER,
  request_id TEXT,
  paypal_order_id TEXT UNIQUE,
  approve_url TEXT,
  paypal_capture_id TEXT,
  paypal_authorization_id TEXT,
  hold_expires_at TEXT,
  approval_id TEXT,
  dispute_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  purchase_id TEXT,
  status TEXT,
  summary TEXT,
  reasons TEXT,
  created_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT
);

CREATE TABLE IF NOT EXISTS evidence_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT UNIQUE,
  prev_hash TEXT,
  hash TEXT,
  timestamp TEXT,
  purchase_id TEXT,
  paypal_order_id TEXT,
  mandate_id TEXT,
  body TEXT
);

CREATE INDEX IF NOT EXISTS evidence_records_purchase_id_idx ON evidence_records (purchase_id);
CREATE INDEX IF NOT EXISTS evidence_records_paypal_order_id_idx ON evidence_records (paypal_order_id);
CREATE INDEX IF NOT EXISTS evidence_records_mandate_id_idx ON evidence_records (mandate_id);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  paypal_dispute_id TEXT UNIQUE,
  simulated INTEGER,
  purchase_id TEXT,
  paypal_order_id TEXT,
  status TEXT,
  reason TEXT,
  amount_value TEXT,
  currency_code TEXT,
  packet TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT,
  resource_type TEXT,
  received_at TEXT,
  verified INTEGER,
  processed INTEGER,
  purchase_id TEXT,
  error TEXT,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY,
  mandate_id TEXT,
  text TEXT,
  outcome TEXT,
  reply TEXT,
  purchase_id TEXT,
  approval_id TEXT,
  evidence_record_id TEXT,
  created_at TEXT
);

CREATE TRIGGER IF NOT EXISTS evidence_records_no_update
BEFORE UPDATE ON evidence_records
BEGIN
  SELECT RAISE(ABORT, 'evidence_records is append-only');
END;

CREATE TRIGGER IF NOT EXISTS evidence_records_no_delete
BEFORE DELETE ON evidence_records
BEGIN
  SELECT RAISE(ABORT, 'evidence_records is append-only');
END;

CREATE TRIGGER IF NOT EXISTS mandate_versions_no_update
BEFORE UPDATE ON mandate_versions
BEGIN
  SELECT RAISE(ABORT, 'mandate_versions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS mandate_versions_no_delete
BEFORE DELETE ON mandate_versions
BEGIN
  SELECT RAISE(ABORT, 'mandate_versions is append-only');
END;
