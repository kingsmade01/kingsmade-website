-- KINGSMADE social-sharing and primary-domain settings
-- Apply only to the isolated admin-test database during preview testing.
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  primary_domain TEXT NOT NULL DEFAULT 'kingsmade.com.ng',
  site_name TEXT NOT NULL DEFAULT 'KINGSMADE',
  page_title TEXT NOT NULL DEFAULT 'KINGSMADE | Craft for Kings',
  description TEXT NOT NULL DEFAULT 'Premium menswear, accessories and fabrics. Simple. Clean. Timeless.',
  image_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO site_settings
  (id, primary_domain, site_name, page_title, description, image_url)
VALUES
  (1, 'kingsmade.com.ng', 'KINGSMADE', 'KINGSMADE | Craft for Kings',
   'Premium menswear, accessories and fabrics. Simple. Clean. Timeless.', '');
