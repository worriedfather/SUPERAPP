-- ============================================================================
--  DA Fuel Control — database schema
-- ----------------------------------------------------------------------------
--  Design principles (agreed with Head of Finance, see CLAUDE.md build item 1):
--
--   1. LEDGER, NOT A WHITEBOARD. Nothing is edited or deleted. Every business
--      event is a new row that records WHO did it and WHEN. Current state
--      (a request's status, a card's balance) is DERIVED by reading the log,
--      never stored as a mutable figure.
--
--   2. TAMPER-EVIDENT. Every append-only row carries a SHA-256 fingerprint
--      computed from its own contents plus the previous row's fingerprint
--      (a hash chain). Alter any past row and every fingerprint after it stops
--      matching. da_verify_chain() re-checks it; export the chain head off-box
--      (see server/README.md) so a wholesale rewrite is still caught.
--
--   3. SELF-HOSTED POSTGRES ONLY. No managed-cloud features. Runs on one box
--      in Harare with a streaming standby. Requires only the pgcrypto
--      extension (ships with PostgreSQL).
--
--  Apply once as the database owner:  psql -d dafuel -f db/schema.sql
--  Then grant the application role:    psql -d dafuel -f db/roles.sql
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() for SHA-256

-- ============================================================================
--  MASTER DATA  (slow-changing; editable, but every change is logged to
--  audit_log by the da_audit trigger. DELETE is blocked — disable instead.)
-- ============================================================================

-- Every person or system that can act. A PIN identifies a person; the PIN is
-- stored only as a one-way hash (bcrypt), never in the clear. The card-system
-- feed is itself an actor, so machine-posted rows are attributable too.
CREATE TABLE actor (
    actor_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login         text NOT NULL UNIQUE,            -- card number (drivers) or username (staff)
    kind          text NOT NULL CHECK (kind IN ('driver','approver','card_system','admin')),
    display_name  text NOT NULL,
    pin_hash      text,                            -- bcrypt; null for non-login system actors
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Drivers. A card belongs permanently to one driver (agreed), so the card
-- number lives here as a unique attribute.
CREATE TABLE driver (
    driver_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id      bigint NOT NULL UNIQUE REFERENCES actor(actor_id),
    card_number   text NOT NULL UNIQUE,
    name          text NOT NULL,
    type          text NOT NULL CHECK (type IN ('fleet','retail')),
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE horse (
    horse_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          text NOT NULL UNIQUE,
    trailer       text,                            -- usual trailer
    kmpl          numeric(6,2) NOT NULL,           -- consumption on record
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trailer (
    trailer_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          text NOT NULL UNIQUE
);

CREATE TABLE vehicle (                             -- retail vehicles / equipment
    vehicle_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          text NOT NULL UNIQUE,
    description   text
);

CREATE TABLE station (
    station_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    lat           double precision NOT NULL,       -- APPROXIMATE until surveyed
    lon           double precision NOT NULL,
    is_depot      boolean NOT NULL DEFAULT false,
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
--  APPEND-ONLY LOG  (the evidence — written once, never edited or deleted)
--
--  Shared columns on every log table:
--    seq         monotonic order + primary key (also the chain order)
--    created_at  the SERVER clock — the authoritative "moment"
--    device_time the phone's own clock, so any gap is visible not hidden
--    created_by  the actor who caused the row
--    prev_hash / row_hash  the tamper-evident chain (set by da_append_only)
-- ============================================================================

-- One row per request, written when the driver presses Send. Never updated.
-- Decision-relevant figures are SNAPSHOTTED here (planned_kmpl, opening_balance,
-- station coordinates, distance source) so a later master-data edit cannot
-- quietly rewrite what this request meant at the time.
CREATE SEQUENCE request_ref_seq;                   -- drives the human ref REQ-0001

CREATE TABLE request (
    seq             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ref             text NOT NULL UNIQUE
                        DEFAULT ('REQ-' || lpad(nextval('request_ref_seq')::text, 4, '0')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    device_time     timestamptz,
    created_by      bigint NOT NULL REFERENCES actor(actor_id),

    -- who and what (snapshots of master values as they read at request time)
    driver_id       bigint NOT NULL REFERENCES driver(driver_id),
    card_number     text NOT NULL,
    driver_name     text NOT NULL,
    driver_type     text NOT NULL CHECK (driver_type IN ('fleet','retail')),
    mode            text NOT NULL CHECK (mode IN ('delivery','general')),
    horse_code      text,                          -- fleet: horse; retail: vehicle code
    trailer_code    text,
    vehicle_code    text,

    -- where the fuel is drawn, and the GPS proof of presence
    fuel_station    text NOT NULL,
    station_lat     double precision,
    station_lon     double precision,
    gps_metres      integer,                       -- distance from site centre
    gps_accuracy_m  integer,                       -- fix accuracy

    -- odometer evidence (typed + photographed + read)
    odo_typed       numeric(10,1) NOT NULL,
    ocr_value       numeric(10,1),
    ocr_confidence  integer,
    ocr_state       text,                          -- read / nodigits / failed / unavailable ...
    ocr_gap         numeric(10,1),
    ocr_mismatch    boolean NOT NULL DEFAULT false,
    photo_sha256    bytea,                         -- links to request_photo, folded into this row's hash

    -- journey + distance (the route is captured atomically as evidence)
    stops           jsonb,                         -- ["DA Yard","Glenara","Mutare 4th Street"]
    legs            jsonb,                         -- [30, 260]  km per leg
    route_km        numeric(10,1),
    distance_source text,                          -- Google Directions / OpenStreetMap / straight-line
    loc_km          numeric(10,1),
    hwy_km          numeric(10,1),
    blended_kmpl    numeric(6,2),
    planned_kmpl    numeric(6,2),

    -- the ask
    requested_litres numeric(10,1) NOT NULL,
    reason          text,
    opening_balance numeric(12,1),

    prev_hash       bytea,
    row_hash        bytea
);
CREATE INDEX request_card_idx ON request(card_number);
CREATE INDEX request_driver_idx ON request(driver_id);

-- The odometer photograph, stored as bytes (agreed: in the database, so it
-- replicates and backs up with everything else). Its sha256 is duplicated onto
-- request.photo_sha256 so a swapped image breaks the request's chain too.
CREATE TABLE request_photo (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    request_seq   bigint NOT NULL UNIQUE REFERENCES request(seq),
    content_type  text NOT NULL DEFAULT 'image/jpeg',
    image         bytea NOT NULL,
    sha256        bytea NOT NULL,
    prev_hash     bytea,
    row_hash      bytea
);

-- Append-only approvals/declines. A change of mind is a NEW row that names the
-- one it supersedes; both remain. Current decision = latest row for a request.
CREATE TABLE decision (
    seq              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at       timestamptz NOT NULL DEFAULT now(),
    device_time      timestamptz,
    created_by       bigint NOT NULL REFERENCES actor(actor_id),
    request_seq      bigint NOT NULL REFERENCES request(seq),
    outcome          text NOT NULL CHECK (outcome IN ('approved','declined')),
    allocated_litres numeric(10,1),               -- null when declined
    note             text,
    supersedes_seq   bigint REFERENCES decision(seq),
    prev_hash        bytea,
    row_hash         bytea
);
CREATE INDEX decision_request_idx ON decision(request_seq);

-- Append-only pump draws posted back (today: from the manual "Card system"
-- tab; later: from the DA card platform once its API is confirmed — build
-- item 5 is blocked until then, so this stays behind the same manual postback).
CREATE TABLE redemption (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    request_seq   bigint NOT NULL REFERENCES request(seq),
    litres_taken  numeric(10,1) NOT NULL,
    station       text,
    odo_at_fill   numeric(10,1),
    external_ref  text UNIQUE,                     -- card system's own id; blocks a double-post
    prev_hash     bytea,
    row_hash      bytea
);
CREATE INDEX redemption_request_idx ON redemption(request_seq);

-- The financial spine. One +litres line per approval load, one -litres line
-- per draw. BALANCE IS NEVER STORED — it is the running sum of this table.
CREATE TABLE card_ledger (
    seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at     timestamptz NOT NULL DEFAULT now(),
    device_time    timestamptz,
    created_by     bigint NOT NULL REFERENCES actor(actor_id),
    card_number    text NOT NULL,
    signed_litres  numeric(12,1) NOT NULL,         -- + load, - draw
    source_kind    text NOT NULL CHECK (source_kind IN ('load','draw')),
    decision_seq   bigint REFERENCES decision(seq),
    redemption_seq bigint REFERENCES redemption(seq),
    note           text,
    prev_hash      bytea,
    row_hash       bytea
);
CREATE INDEX card_ledger_card_idx ON card_ledger(card_number);

-- Every change to master data (add driver, correct a horse's km/L, …).
CREATE TABLE audit_log (
    seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   bigint REFERENCES actor(actor_id),   -- from da.actor_id GUC
    table_name   text NOT NULL,
    row_pk       text,
    op           text NOT NULL,
    old_row      jsonb,
    new_row      jsonb,
    prev_hash    bytea,
    row_hash     bytea
);

-- ============================================================================
--  APPEND-ONLY ENFORCEMENT + HASH CHAIN
--
--  da_append_only() is one generic trigger reused on every log table. It:
--    * rejects any UPDATE or DELETE outright (belt to the role permissions);
--    * on INSERT, serialises writers on that table (so the chain cannot fork),
--      reads the previous row's fingerprint, and sets prev_hash/row_hash to
--      SHA-256( previous_hash || this row's contents ).
--
--  The row's "contents" is its JSON form minus the two hash columns — a
--  deterministic, column-order-stable serialisation.
-- ============================================================================

CREATE OR REPLACE FUNCTION da_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prev    bytea;
    payload text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'append-only violation: % is not allowed on %',
            TG_OP, TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;

    -- serialise inserts on this table for the rest of the transaction, so two
    -- concurrent writers cannot both chain off the same previous row
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME)::bigint);

    EXECUTE format('SELECT row_hash FROM %I.%I ORDER BY seq DESC LIMIT 1',
                   TG_TABLE_SCHEMA, TG_TABLE_NAME)
        INTO prev;
    IF prev IS NULL THEN
        prev := decode(repeat('00', 32), 'hex');   -- genesis: 32 zero bytes
    END IF;

    payload := (to_jsonb(NEW) - 'prev_hash' - 'row_hash')::text;
    NEW.prev_hash := prev;
    NEW.row_hash  := digest(prev || convert_to(payload, 'UTF8'), 'sha256');
    RETURN NEW;
END $$;

CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON request
    FOR EACH ROW EXECUTE FUNCTION da_append_only();
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON request_photo
    FOR EACH ROW EXECUTE FUNCTION da_append_only();
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON decision
    FOR EACH ROW EXECUTE FUNCTION da_append_only();
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON redemption
    FOR EACH ROW EXECUTE FUNCTION da_append_only();
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON card_ledger
    FOR EACH ROW EXECUTE FUNCTION da_append_only();
CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION da_append_only();

-- Re-walk a chain and report the first row whose fingerprint does not
-- recompute. ok=true means the whole table verifies.
--   SELECT * FROM da_verify_chain('request');
CREATE OR REPLACE FUNCTION da_verify_chain(tbl regclass)
RETURNS TABLE(ok boolean, broken_seq bigint, rows_checked bigint)
LANGUAGE plpgsql AS $$
DECLARE
    r       record;
    prev    bytea := decode(repeat('00', 32), 'hex');
    calc    bytea;
    payload text;
    cnt     bigint := 0;
BEGIN
    FOR r IN EXECUTE format('SELECT * FROM %s ORDER BY seq', tbl) LOOP
        cnt := cnt + 1;
        payload := (to_jsonb(r) - 'prev_hash' - 'row_hash')::text;
        calc := digest(prev || convert_to(payload, 'UTF8'), 'sha256');
        IF r.prev_hash IS DISTINCT FROM prev OR r.row_hash IS DISTINCT FROM calc THEN
            ok := false; broken_seq := r.seq; rows_checked := cnt;
            RETURN NEXT; RETURN;
        END IF;
        prev := r.row_hash;
    END LOOP;
    ok := true; broken_seq := NULL; rows_checked := cnt;
    RETURN NEXT;
END $$;

-- ============================================================================
--  MASTER-DATA AUDIT  (log every insert/update; block deletes)
--  Backend sets  SET LOCAL da.actor_id = <id>  so the change is attributable.
-- ============================================================================

CREATE OR REPLACE FUNCTION da_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    actor bigint := NULLIF(current_setting('da.actor_id', true), '')::bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'delete not allowed on master table % — set status=disabled instead',
            TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO audit_log(created_by, table_name, row_pk, op, old_row, new_row)
    VALUES (actor, TG_TABLE_NAME, to_jsonb(NEW) ->> TG_ARGV[0], TG_OP,
            CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
            to_jsonb(NEW));
    RETURN NEW;
END $$;

CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON actor
    FOR EACH ROW EXECUTE FUNCTION da_audit('actor_id');
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON driver
    FOR EACH ROW EXECUTE FUNCTION da_audit('card_number');
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON horse
    FOR EACH ROW EXECUTE FUNCTION da_audit('code');
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON station
    FOR EACH ROW EXECUTE FUNCTION da_audit('name');
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON vehicle
    FOR EACH ROW EXECUTE FUNCTION da_audit('code');
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON trailer
    FOR EACH ROW EXECUTE FUNCTION da_audit('code');

-- ============================================================================
--  DERIVED VIEWS  (convenience only — disposable, rebuildable from the log)
-- ============================================================================

-- Current status of each request, computed from the latest decision + redemption.
CREATE VIEW v_request_status AS
SELECT r.seq  AS request_seq,
       r.ref,
       d.outcome,
       d.allocated_litres,
       rd.litres_taken,
       CASE
           WHEN rd.seq IS NOT NULL           THEN 'redeemed'
           WHEN d.outcome = 'approved'       THEN 'approved'
           WHEN d.outcome = 'declined'       THEN 'declined'
           ELSE 'pending'
       END AS status
FROM request r
LEFT JOIN LATERAL (
    SELECT * FROM decision d2 WHERE d2.request_seq = r.seq ORDER BY d2.seq DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
    SELECT * FROM redemption r2 WHERE r2.request_seq = r.seq ORDER BY r2.seq DESC LIMIT 1
) rd ON true;

-- Card balance = the running sum of the ledger. Never stored.
CREATE VIEW v_card_balance AS
SELECT card_number, COALESCE(SUM(signed_litres), 0)::numeric(12,1) AS balance
FROM card_ledger
GROUP BY card_number;

COMMIT;
