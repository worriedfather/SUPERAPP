-- ============================================================================
--  DA Super App — grants for the application role (da_app)
-- ----------------------------------------------------------------------------
--  Same principle as db/roles.sql: da_app may INSERT and SELECT the append-only
--  log tables but CANNOT update or delete them. Master `site` is read/insert/
--  update (edits captured by da_audit). Run as owner AFTER superapp.sql:
--     psql -d dafuel -f db/superapp-roles.sql
-- ============================================================================

BEGIN;

-- Master data: read, add, amend (audited). No delete (blocked by da_audit).
GRANT SELECT, INSERT, UPDATE ON site TO da_app;

-- Append-only log: INSERT and SELECT only. No UPDATE. No DELETE. On purpose.
GRANT SELECT, INSERT ON site_stock, price_survey, sales_survey,
                        delivery_note, delivery_photo, recon_day TO da_app;

-- New identity sequences need usage to insert.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app;

-- Derived views are read-only.
GRANT SELECT ON v_site_stock_latest, v_sales_latest, v_price_latest TO da_app;

COMMIT;
