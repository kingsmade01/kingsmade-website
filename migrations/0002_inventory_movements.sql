-- KINGSMADE admin-test inventory movement history
-- Safe for the isolated admin-test database; no production database is targeted.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
  ON inventory_movements(product_id, created_at DESC);
