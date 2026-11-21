-- Add customer contact fields required by the admin customer view.
-- Applies only to the isolated admin-test database through this branch's migrations.
ALTER TABLE orders ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';
