-- ============================================================================
--  DA Fuel Control — application role and grants
-- ----------------------------------------------------------------------------
--  The second lock on "append-only". The application connects as da_app, a
--  role that PHYSICALLY CANNOT update or delete the log tables — the grants
--  simply are not there. Even a bug in the backend cannot rewrite history.
--  (The triggers in schema.sql are the belt; these grants are the braces.)
--
--  The schema itself should be owned by a SEPARATE, more privileged role
--  (e.g. da_owner) used only for migrations — never by da_app.
--
--  Run as the database owner AFTER schema.sql:
--     psql -d dafuel -f db/roles.sql
--  Set a real password first (or use a .pgpass / peer auth).
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'da_app') THEN
        CREATE ROLE da_app LOGIN PASSWORD 'Bp8RcWi4QhxKXRccajG8d992ZEFe';
    END IF;
END $$;

GRANT CONNECT ON DATABASE dafuel TO da_app;
GRANT USAGE  ON SCHEMA public TO da_app;

-- Master data: the app may read, add and amend (edits are captured by da_audit).
GRANT SELECT, INSERT, UPDATE ON actor, driver, horse, trailer, vehicle, station TO da_app;

-- Append-only log: INSERT and SELECT only. No UPDATE. No DELETE. On purpose.
GRANT SELECT, INSERT ON request, request_photo, decision, redemption, card_ledger, audit_log TO da_app;

-- Identity columns need the sequence usage to insert.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app;

-- Derived views are read-only.
GRANT SELECT ON v_request_status, v_card_balance TO da_app;

-- Let the app call the chain verifier for the audit screen.
GRANT EXECUTE ON FUNCTION da_verify_chain(regclass) TO da_app;

-- Deliberately NOT granted to da_app: UPDATE/DELETE on any log table,
-- DELETE on any master table, ownership of anything, or superuser. A DBA with
-- server access can still bypass all of this — that is why the hash chain and
-- the off-box chain-head checkpoint exist (see server/README.md).

COMMIT;
