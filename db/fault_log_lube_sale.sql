-- Committed DDL for two hash-chained ledger tables that were created live but had
-- no source-of-truth in db/ (audit finding #22 — schema drift). This file makes a
-- rebuild reproduce them WITH their append-only + hash-chain guard, and documents
-- the live shape. Mirrors the running schema as of 2026-08-29.
--
-- Both carry the da_append_only trigger, so they are automatically covered by the
-- integrity monitor and /api/verify (which now discover chained tables from
-- pg_trigger rather than a hand-maintained list).

CREATE TABLE IF NOT EXISTS fault_log (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref          text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  device_time  timestamptz,
  created_by   bigint NOT NULL,
  vehicle_code text,
  category     text,
  severity     text,
  title        text,
  description  text,
  odometer     numeric,
  status       text NOT NULL DEFAULT 'open',
  note         text,
  photo_sha256 bytea,
  prev_hash    bytea,
  row_hash     bytea,
  entry_type   text NOT NULL DEFAULT 'fault'
);

CREATE TABLE IF NOT EXISTS lube_sale (
  seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  device_time   timestamptz,
  created_by    bigint NOT NULL,
  site_id       bigint,
  site_name     text,
  items         jsonb NOT NULL,
  total         numeric NOT NULL,
  payment_method text,
  customer      text,
  fiscal_status text NOT NULL DEFAULT 'pending',
  fiscal_ref    text,
  note          text,
  prev_hash     bytea,
  row_hash      bytea
);

-- attach the append-only + chain-signing trigger (idempotent)
DROP TRIGGER IF EXISTS t_append_only ON fault_log;
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON fault_log
  FOR EACH ROW EXECUTE FUNCTION da_append_only();
DROP TRIGGER IF EXISTS t_append_only ON lube_sale;
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON lube_sale
  FOR EACH ROW EXECUTE FUNCTION da_append_only();

-- least privilege: da_app may only INSERT + SELECT on chained tables
GRANT SELECT, INSERT ON fault_log TO da_app;
GRANT SELECT, INSERT ON lube_sale TO da_app;
