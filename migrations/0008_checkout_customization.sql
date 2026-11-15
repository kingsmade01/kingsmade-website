-- KINGSMADE checkout customization and bespoke tailoring
-- Apply to TEST D1 first. Do not apply to production without a reviewed rollout.

CREATE TABLE IF NOT EXISTS product_option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  group_key TEXT NOT NULL,
  label TEXT NOT NULL,
  input_type TEXT NOT NULL DEFAULT 'select',
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  options_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_option_groups_product
  ON product_option_groups(product_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS tailoring_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price_ngn INTEGER NOT NULL DEFAULT 0 CHECK (price_ngn >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_measurement_profiles (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT 'My measurements',
  measurement_unit TEXT NOT NULL CHECK (measurement_unit IN ('cm','in')),
  measurements_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measurement_profiles_customer
  ON customer_measurement_profiles(customer_id, updated_at);

CREATE TABLE IF NOT EXISTS order_item_customizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL UNIQUE,
  product_options_json TEXT NOT NULL DEFAULT '{}',
  fabric_yards REAL,
  tailoring_requested INTEGER NOT NULL DEFAULT 0 CHECK (tailoring_requested IN (0,1)),
  tailoring_style_id INTEGER,
  tailoring_price_ngn INTEGER NOT NULL DEFAULT 0,
  measurement_unit TEXT,
  measurements_json TEXT NOT NULL DEFAULT '{}',
  customer_instructions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (tailoring_style_id) REFERENCES tailoring_styles(id)
);

ALTER TABLE orders ADD COLUMN customer_country TEXT NOT NULL DEFAULT 'Nigeria';
ALTER TABLE orders ADD COLUMN customer_state TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_city TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_area TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_address_line1 TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_address_line2 TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_landmark TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_fee_ngn INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN subtotal_ngn INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN tailoring_total_ngn INTEGER NOT NULL DEFAULT 0;
