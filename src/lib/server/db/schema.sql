-- OpenCommerce :: schema (SQLite default driver)
-- Every important table carries organization_id + store_id from day one, even
-- though the MVP enforces 1 user -> 1 personal org -> 1 store in the service
-- layer. Columns are cheap now; a backfill migration later is not.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_org_owner ON organizations(owner_user_id);

-- Reserved for phase-2 teams/RBAC. Unused by the MVP; its presence is what
-- makes roles a pure addition rather than a rewrite.
CREATE TABLE IF NOT EXISTS memberships (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'owner',
  created_at      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stores (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'native',
  platform_id     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  description     TEXT NOT NULL DEFAULT '',
  logo_url        TEXT NOT NULL DEFAULT '',
  banner_url      TEXT NOT NULL DEFAULT '',
  support_email   TEXT NOT NULL DEFAULT '',
  support_phone   TEXT NOT NULL DEFAULT '',
  website         TEXT NOT NULL DEFAULT '',
  legal_name      TEXT NOT NULL DEFAULT '',
  business_type   TEXT NOT NULL DEFAULT '',
  tax_id          TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '',
  address_line1   TEXT NOT NULL DEFAULT '',
  address_line2   TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  state           TEXT NOT NULL DEFAULT '',
  postal_code     TEXT NOT NULL DEFAULT '',
  country         TEXT NOT NULL DEFAULT 'IN',
  currency        TEXT NOT NULL DEFAULT 'INR',
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stores_org ON stores(organization_id);

-- Pickup / dispatch addresses. Distinct from the registered office on
-- `stores`: marketplaces route couriers to these, and a seller commonly has
-- several (a warehouse, a workshop, a retail counter).
CREATE TABLE IF NOT EXISTS pickup_locations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  contact_name    TEXT NOT NULL DEFAULT '',
  contact_phone   TEXT NOT NULL DEFAULT '',
  address_line1   TEXT NOT NULL DEFAULT '',
  address_line2   TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  state           TEXT NOT NULL DEFAULT '',
  postal_code     TEXT NOT NULL DEFAULT '',
  country         TEXT NOT NULL DEFAULT 'IN',
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pickup_store ON pickup_locations(store_id);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'native',
  sku             TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  brand           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  attributes      TEXT NOT NULL DEFAULT '{}',
  tax_rate_bp     INTEGER NOT NULL DEFAULT 0,
  hsn_code        TEXT NOT NULL DEFAULT '',
  weight_g        INTEGER NOT NULL DEFAULT 0,
  length_mm       INTEGER NOT NULL DEFAULT 0,
  width_mm        INTEGER NOT NULL DEFAULT 0,
  height_mm       INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (store_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_external ON products(external_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

CREATE TABLE IF NOT EXISTS product_variants (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL DEFAULT '',
  sku         TEXT NOT NULL,
  barcode     TEXT NOT NULL DEFAULT '',
  options     TEXT NOT NULL DEFAULT '{}',
  price_cents INTEGER NOT NULL DEFAULT 0,
  mrp_cents   INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'INR',
  available   INTEGER NOT NULL DEFAULT 0,
  reserved    INTEGER NOT NULL DEFAULT 0,
  weight_g    INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

CREATE TABLE IF NOT EXISTS product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  url        TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS channels (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  connector       TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'UNKNOWN',
  mode            TEXT NOT NULL DEFAULT 'live',
  config          TEXT NOT NULL DEFAULT '{}',
  last_health_at  INTEGER,
  last_error      TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_channels_store ON channels(store_id);

-- Encrypted at rest (AES-256-GCM). Never serialised into an API response.
CREATE TABLE IF NOT EXISTS credentials (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL DEFAULT '',
  channel_id      TEXT NOT NULL DEFAULT '',
  provider        TEXT NOT NULL,
  auth_type       TEXT NOT NULL DEFAULT 'oauth2',
  ciphertext      BLOB NOT NULL,
  expires_at      INTEGER,
  scopes          TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_credentials_channel ON credentials(channel_id);

CREATE TABLE IF NOT EXISTS product_mappings (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  remote_product_id TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'PENDING',
  mapping_data      TEXT NOT NULL DEFAULT '{}',
  missing_fields    TEXT NOT NULL DEFAULT '[]',
  version           INTEGER NOT NULL DEFAULT 0,
  last_synced_at    INTEGER,
  last_error        TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_mappings_product ON product_mappings(product_id);
CREATE INDEX IF NOT EXISTS idx_mappings_channel ON product_mappings(channel_id);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL DEFAULT '',
  operation       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload         TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT NOT NULL DEFAULT '',
  error_class     TEXT NOT NULL DEFAULT '',
  locked_by       TEXT NOT NULL DEFAULT '',
  locked_at       INTEGER,
  created_at      INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER,
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON sync_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_jobs_store ON sync_jobs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_channel ON sync_jobs(channel_id);

CREATE TABLE IF NOT EXISTS sync_attempts (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  attempt     INTEGER NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT NOT NULL DEFAULT '',
  error_class TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  request_log TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attempts_job ON sync_attempts(job_id);

-- Transactional outbox: the event row is written in the same transaction as the
-- state change that produced it, so a crash can never lose a sync.
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',
  published_at    INTEGER,
  created_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_unpublished ON events(published_at, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL DEFAULT '',
  actor_user_id   TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL DEFAULT '',
  entity_id       TEXT NOT NULL DEFAULT '',
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL,
  source            TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  payload           TEXT NOT NULL DEFAULT '{}',
  received_at       INTEGER NOT NULL DEFAULT 0,
  processed_at      INTEGER,
  UNIQUE (source, external_event_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  store_id         TEXT NOT NULL,
  channel_id       TEXT NOT NULL DEFAULT '',
  external_id      TEXT NOT NULL,
  source           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'NEW',
  currency         TEXT NOT NULL DEFAULT 'INR',
  total_cents      INTEGER NOT NULL DEFAULT 0,
  customer         TEXT NOT NULL DEFAULT '{}',
  shipping_address TEXT NOT NULL DEFAULT '{}',
  placed_at        INTEGER,
  created_at       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  quantity       INTEGER NOT NULL DEFAULT 1,
  price_cents    INTEGER NOT NULL DEFAULT 0,
  remote_item_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Watchtower (phase 2). Detection is deterministic hashing/diffing; analysis
-- happens outside the core, over MCP. Tables reserved so the shape is fixed.
CREATE TABLE IF NOT EXISTS api_observations (
  id           TEXT PRIMARY KEY,
  connector    TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  source_url   TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  metadata     TEXT NOT NULL DEFAULT '{}',
  observed_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_observations_connector ON api_observations(connector, observed_at DESC);

CREATE TABLE IF NOT EXISTS api_changes (
  id          TEXT PRIMARY KEY,
  connector   TEXT NOT NULL,
  change_type TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'UNKNOWN',
  summary     TEXT NOT NULL DEFAULT '',
  diff        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'OPEN',
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS imports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  csv_text        TEXT NOT NULL,
  row_count       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'UPLOADED',
  results         TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_imports_store ON imports(store_id, created_at DESC);
