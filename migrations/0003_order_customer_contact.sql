-- KINGSMADE admin-test customer contact fields
-- Adds the fields required by the admin customer summary endpoint.
-- This migration targets only the isolated kingsmade-admin-test-db.

ALTER TABLE orders
  ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';
