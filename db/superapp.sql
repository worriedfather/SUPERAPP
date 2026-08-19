-- ============================================================================
--  DA Super App — schema extension (the WhatsApp-bot consolidation)
-- ----------------------------------------------------------------------------
--  Adds the modules that replace the six WhatsApp bots with in-app submission:
--
--    site_stock    ← "STOCK DA SITES"          (nightly closing stock / site / shift)
--    price_survey  ← "DA $ PRICE SURVEYS"       (DA vs competitor prices / site / day)
--    sales_survey  ← "DA SALES SITES"           (daily sales + closing stock / site / shift)
--    delivery_note ← "DA MOTORS DELIVERIES."    (fuel delivery notes + transit loss)
--    recon_day     ← "LOGISTICS DELIVERIES"     (depot fuel reconciliation)
--
--  Fuel allocation ("DA Driver Fuel allocation") is ALREADY handled by the
--  existing request/decision/redemption tables — no new table needed.
--
--  DESIGN: identical to db/schema.sql — every business event is one append-only,
--  hash-chained, attributable row. Current state is DERIVED, never stored. New
--  master (`site`) is editable but audited; deletes blocked. Reuses the generic
--  da_append_only() and da_audit() triggers already defined in schema.sql.
--
--  IDEMPOTENT: safe to run repeatedly and safe on the live pilot DB — it only
--  ADDS objects, never touches request/decision/redemption/card_ledger or any
--  loaded data.
--
--  Apply as the database OWNER, AFTER schema.sql:
--     psql -d dafuel -f db/superapp.sql
--     psql -d dafuel -f db/superapp-roles.sql     -- grants for da_app
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
--  1. New actor roles: site_manager (retail sites) and depot (recon).
--     The kind CHECK constraint is widened in place; existing rows are unaffected.
-- ----------------------------------------------------------------------------
ALTER TABLE actor DROP CONSTRAINT IF EXISTS actor_kind_check;
ALTER TABLE actor ADD  CONSTRAINT actor_kind_check
    CHECK (kind IN ('driver','approver','card_system','admin','site_manager','depot'));

-- ----------------------------------------------------------------------------
--  2. MASTER: retail sites (the ~58 DA filling stations that report stock,
--     price and sales). Distinct from `station` (a place a TRUCK draws fuel,
--     used by the fuel-requisition geo-lock) to keep the two concerns clean,
--     even though many are the same physical forecourt. A site may have a
--     manager assigned; a manager submits only for their own site.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site (
    site_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL UNIQUE,               -- canonical DA site name
    region           text NOT NULL DEFAULT 'Country',    -- Harare / Bulawayo / Country (refinable)
    manager_actor_id bigint REFERENCES actor(actor_id),  -- the site_manager who reports for it
    status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Attribute every master change to a person (same trigger the other masters use).
DROP TRIGGER IF EXISTS t_audit ON site;
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON site
    FOR EACH ROW EXECUTE FUNCTION da_audit('name');

-- ============================================================================
--  3. APPEND-ONLY LOG TABLES
--     Shared columns (as in schema.sql): seq, created_at (server clock),
--     device_time (phone clock), created_by (actor), prev_hash/row_hash (chain).
--     A correction is a NEW row; the latest row for a logical key wins in the
--     read-model. Nothing is ever edited or deleted.
-- ============================================================================

-- 3a. Site stock — replaces the Stock bot. One row per (site, trading_date,
--     shift) submission; product litres captured directly, no OCR guessing.
CREATE TABLE IF NOT EXISTS site_stock (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    site_id       bigint NOT NULL REFERENCES site(site_id),
    site_name     text NOT NULL,                         -- snapshot
    trading_date  date NOT NULL,
    shift         text NOT NULL CHECK (shift IN ('day','night')),
    blend_litres  numeric(12,1),
    diesel_litres numeric(12,1),
    note          text,
    prev_hash     bytea,
    row_hash      bytea
);
CREATE INDEX IF NOT EXISTS site_stock_key_idx ON site_stock(trading_date, site_id, shift);

-- 3b. Price survey — replaces the Price Survey bot. One row per (site, date)
--     submission. The competitor price lines are captured atomically as jsonb,
--     mirroring how request.stops/legs are stored — the whole survey is one
--     piece of evidence. Lines: [{station,brand,isDA,fuelType,price}].
CREATE TABLE IF NOT EXISTS price_survey (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    site_id       bigint NOT NULL REFERENCES site(site_id),
    site_name     text NOT NULL,
    region        text,
    trading_date  date NOT NULL,
    lines         jsonb NOT NULL,                        -- [{station,brand,isDA,fuelType,price}]
    note          text,
    prev_hash     bytea,
    row_hash      bytea
);
CREATE INDEX IF NOT EXISTS price_survey_key_idx ON price_survey(trading_date, site_id);

-- 3c. Sales survey — replaces the Sales Survey bot. One row per (site,
--     trading_date, shift): fuel sales + closing stock, typed directly.
CREATE TABLE IF NOT EXISTS sales_survey (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    site_id       bigint NOT NULL REFERENCES site(site_id),
    site_name     text NOT NULL,
    trading_date  date NOT NULL,
    shift         text NOT NULL CHECK (shift IN ('day','night')),
    blend_sales   numeric(12,1),
    diesel_sales  numeric(12,1),
    blend_stock   numeric(12,1),
    diesel_stock  numeric(12,1),
    note          text,
    prev_hash     bytea,
    row_hash      bytea
);
CREATE INDEX IF NOT EXISTS sales_survey_key_idx ON sales_survey(trading_date, site_id, shift);

-- 3d. Delivery note — replaces the Delivery bot. One row per D/N. Fields typed
--     by the driver (optionally with a photo of the paper note as evidence).
--     Loss figures are DERIVED in the read-model, not stored, so they always
--     reflect the numbers on this row.
CREATE TABLE IF NOT EXISTS delivery_note (
    seq             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at      timestamptz NOT NULL DEFAULT now(),
    device_time     timestamptz,
    created_by      bigint NOT NULL REFERENCES actor(actor_id),
    driver_id       bigint REFERENCES driver(driver_id),  -- null if submitted by depot/admin
    dn_number       text,
    dn_date         date,
    loaded_from     text,
    delivered_to    text,
    order_no        text,
    truck_reg       text,
    trailer         text,
    truck_name      text,
    commodity       text CHECK (commodity IN ('Diesel','Petrol','Blend','Ethanol')),
    qty_loaded      numeric(12,1),
    site_dip_total  numeric(12,1),
    truck_dip_total numeric(12,1),
    truck_dip_temp  numeric(6,2),
    site_dip_temp   numeric(6,2),
    density         numeric(8,4),
    received_by     text,
    notes           text,
    photo_sha256    bytea,                                -- links delivery_photo; folded into row hash
    prev_hash       bytea,
    row_hash        bytea
);
CREATE INDEX IF NOT EXISTS delivery_note_dn_idx   ON delivery_note(dn_number);
CREATE INDEX IF NOT EXISTS delivery_note_date_idx ON delivery_note(dn_date);

-- The photographed paper note (bytes in the DB, like request_photo).
CREATE TABLE IF NOT EXISTS delivery_photo (
    seq             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at      timestamptz NOT NULL DEFAULT now(),
    device_time     timestamptz,
    created_by      bigint NOT NULL REFERENCES actor(actor_id),
    delivery_seq    bigint NOT NULL UNIQUE REFERENCES delivery_note(seq),
    content_type    text NOT NULL DEFAULT 'image/jpeg',
    image           bytea NOT NULL,
    sha256          bytea NOT NULL,
    prev_hash       bytea,
    row_hash        bytea
);

-- 3e. Recon day — replaces the Recon bot. One row per depot per trading_date.
--     Opening / receipts / deliveries / closing captured as jsonb arrays;
--     the reconciliation (opening + receipts − issued vs closing) is DERIVED.
CREATE TABLE IF NOT EXISTS recon_day (
    seq           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    device_time   timestamptz,
    created_by    bigint NOT NULL REFERENCES actor(actor_id),
    warehouse     text NOT NULL,                         -- Msasa / Feruka
    trading_date  date NOT NULL,
    opening       jsonb NOT NULL,                        -- [{product,litres}]
    receipts      jsonb NOT NULL,                        -- [{product,trucks,litres,supplier}]
    deliveries    jsonb NOT NULL,                        -- [{product,route,litres,truck_plate}]
    closing       jsonb NOT NULL,                        -- [{product,litres}]
    note          text,
    prev_hash     bytea,
    row_hash      bytea
);
CREATE INDEX IF NOT EXISTS recon_day_key_idx ON recon_day(trading_date, warehouse);

-- ----------------------------------------------------------------------------
--  4. Append-only enforcement + hash chain on every new log table
--     (reuses da_append_only() from schema.sql).
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['site_stock','price_survey','sales_survey','delivery_note','delivery_photo','recon_day']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS t_append_only ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER t_append_only BEFORE INSERT OR UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION da_append_only()', t);
    END LOOP;
END $$;

-- ============================================================================
--  5. DERIVED VIEWS (convenience — disposable, rebuildable from the log)
-- ============================================================================

-- Latest stock reading per (site, trading_date, shift): the newest row wins,
-- so a correction supersedes the original without editing it.
CREATE OR REPLACE VIEW v_site_stock_latest AS
SELECT DISTINCT ON (trading_date, site_id, shift)
       trading_date, site_id, site_name, shift, blend_litres, diesel_litres, created_at, seq
FROM site_stock
ORDER BY trading_date, site_id, shift, seq DESC;

-- Latest sales reading per (site, trading_date, shift).
CREATE OR REPLACE VIEW v_sales_latest AS
SELECT DISTINCT ON (trading_date, site_id, shift)
       trading_date, site_id, site_name, shift,
       blend_sales, diesel_sales, blend_stock, diesel_stock, created_at, seq
FROM sales_survey
ORDER BY trading_date, site_id, shift, seq DESC;

-- Authoritative daily sales per (site, trading_date).
--
-- Two problems with the raw WhatsApp Sales-Survey feed, both fixed here:
--
-- 1. DOUBLE-COUNT. The forecourt "day" and "night" messages are CUMULATIVE
--    pump-meter readings of the SAME trading day (evening = earlier snapshot,
--    morning = final total), not two incremental shifts. Summing them inflates
--    litres ~1.65x (verified Jul 2026: SUM=21.8M vs physical pump 13.5M). The
--    day's true sales is the FINAL (greatest) reading per product — the `survey`
--    CTE below collapses day/night with GREATEST (reconciles to pump at 1.00x).
--
-- 2. COVERAGE. The survey bot only started in March 2026 and has gaps, so YTD
--    badly under-counts (50.6M) vs what was physically delivered (91.5M). The
--    `pump_sales_daily` table holds the authoritative pump-meter sales (Tank Dips
--    export, loaded by import-pump-sales.mjs) — full Jan–Jul, reconciles to
--    deliveries within ~2%. We PREFER pump where it exists and fall back to the
--    collapsed survey for days pump hasn't been exported yet (keeps the live feed).
-- 3. AUTHORITY (2026-08-02). The final daily figure is the DAY-END REPORT
--    (day_end_daily, from DA Site Analytics — pump sales + gain/loss variance).
--    Priority: day_end > pump_sales_daily (tank dips) > survey (indicative). The
--    survey day/night stays available on the retail board as an in-day indication;
--    variance nets against the day-end. ulp only populates for day-end/pump days.
-- 4. RETAIL AUTHORITY (2026-08-02). When the authoritative retail exports have been
--    loaded (import-retail-csv.mjs → retail_sales_daily), they sit ABOVE day-end:
--    retail > day_end > pump > survey. That importer OWNS the live definition and
--    rebuilds this view after every load. The block below keeps db/superapp.sql in
--    lock-step so a fresh seed is correct AND re-running this file never DOWNGRADES a
--    retail-authority view back to the non-retail one (the old "re-seed trap"): it
--    only adds the retail tier when retail_sales_daily actually exists.
DROP VIEW IF EXISTS v_sales_daily;
DO $$
DECLARE
  has_retail boolean := to_regclass('public.retail_sales_daily') IS NOT NULL;
  survey_cte text := $cte$
    WITH survey AS (
      SELECT trading_date, site_id::text AS site_id, max(site_name) AS site_name,
             GREATEST(COALESCE(max(blend_sales)  FILTER (WHERE shift='day'),0),
                      COALESCE(max(blend_sales)  FILTER (WHERE shift='night'),0)) AS blend_sales,
             GREATEST(COALESCE(max(diesel_sales) FILTER (WHERE shift='day'),0),
                      COALESCE(max(diesel_sales) FILTER (WHERE shift='night'),0)) AS diesel_sales
      FROM v_sales_latest GROUP BY trading_date, site_id
    )$cte$;
BEGIN
  IF has_retail THEN
    EXECUTE 'CREATE VIEW v_sales_daily AS ' || survey_cte || $q$,
      keys AS (
        SELECT trading_date, site_id FROM retail_sales_daily
        UNION SELECT trading_date, site_id FROM day_end_daily
        UNION SELECT trading_date, site_id FROM pump_sales_daily
        UNION SELECT trading_date, site_id FROM survey
      )
      SELECT k.trading_date, k.site_id,
        COALESCE(rt.site_name, de.site_name, p.site_name, s.site_name) AS site_name,
        COALESCE(NULLIF(rt.blend_sales,0),  NULLIF(de.blend_sold,0),  p.blend_sales,  s.blend_sales,  0) AS blend_sales,
        COALESCE(NULLIF(rt.diesel_sales,0), NULLIF(de.diesel_sold,0), p.diesel_sales, s.diesel_sales, 0) AS diesel_sales,
        COALESCE(NULLIF(rt.ulp_sales,0),    NULLIF(de.ulp_sold,0),    p.ulp_sales,    0)                 AS ulp_sales,
        CASE WHEN rt.site_id IS NOT NULL THEN 'retail'
             WHEN de.site_id IS NOT NULL THEN 'dayend'
             WHEN p.site_id  IS NOT NULL THEN 'tank_dip'
             ELSE 'survey' END AS source
      FROM keys k
      LEFT JOIN retail_sales_daily rt USING (trading_date, site_id)
      LEFT JOIN day_end_daily      de USING (trading_date, site_id)
      LEFT JOIN pump_sales_daily   p  USING (trading_date, site_id)
      LEFT JOIN survey             s  USING (trading_date, site_id)$q$;
  ELSE
    EXECUTE 'CREATE VIEW v_sales_daily AS ' || survey_cte || $q$,
      keys AS (
        SELECT trading_date, site_id FROM day_end_daily
        UNION SELECT trading_date, site_id FROM pump_sales_daily
        UNION SELECT trading_date, site_id FROM survey
      )
      SELECT k.trading_date, k.site_id,
        COALESCE(de.site_name, p.site_name, s.site_name) AS site_name,
        -- day_end columns DEFAULT 0 and the importer coerces missing cells to 0, so a
        -- product not captured in the day-end report reads 0, NOT NULL. NULLIF lets that
        -- 0 fall through to the pump/survey figure instead of shadowing real litres.
        COALESCE(NULLIF(de.blend_sold, 0),  p.blend_sales,  s.blend_sales,  0) AS blend_sales,
        COALESCE(NULLIF(de.diesel_sold, 0), p.diesel_sales, s.diesel_sales, 0) AS diesel_sales,
        COALESCE(NULLIF(de.ulp_sold, 0),    p.ulp_sales,    0)                 AS ulp_sales,
        CASE WHEN de.site_id IS NOT NULL THEN 'dayend'
             WHEN p.site_id  IS NOT NULL THEN 'tank_dip'
             ELSE 'survey' END AS source
      FROM keys k
      LEFT JOIN day_end_daily   de USING (trading_date, site_id)
      LEFT JOIN pump_sales_daily p  USING (trading_date, site_id)
      LEFT JOIN survey           s  USING (trading_date, site_id)$q$;
  END IF;
END $$;

-- Latest price survey per (site, trading_date).
CREATE OR REPLACE VIEW v_price_latest AS
SELECT DISTINCT ON (trading_date, site_id)
       trading_date, site_id, site_name, region, lines, created_at, seq
FROM price_survey
ORDER BY trading_date, site_id, seq DESC;

COMMIT;
