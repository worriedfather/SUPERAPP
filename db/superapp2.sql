-- ============================================================================
--  DA Super App — submission redesign (tank-level stock, per-site competitors)
-- ----------------------------------------------------------------------------
--  Driven by how sites actually report:
--   * stock is read at TANK level (a site has several tanks), not one site total;
--   * each site has its OWN fixed competitor list for the price survey;
--   * shift is inferred from the time of day (no manual selector);
--   * the previous submission is preloaded so the user only changes what moved.
--
--  site_stock gains a `tanks` jsonb (the per-tank readings); blend/diesel totals
--  are still stored (summed from the tanks) so the dashboards are unchanged.
--  Two new per-site master tables remember each site's tanks and competitors.
--
--  NOTE on the hash chain: adding a column to the append-only site_stock changes
--  every row's serialised payload, so the historical rows must be RELOADED after
--  this runs (they are re-imported by server/import/load-bots.mjs). This is safe
--  because the retail modules are still being loaded, not yet the live ledger.
--
--  Apply as owner, AFTER superapp.sql:
--     psql -d dafuel -f db/superapp2.sql
-- ============================================================================

BEGIN;

-- Per-tank readings on each stock submission: [{label,product,litres}].
ALTER TABLE site_stock ADD COLUMN IF NOT EXISTS tanks jsonb;

-- A site's tanks (the remembered set the stock form preloads).
CREATE TABLE IF NOT EXISTS site_tank (
    tank_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id     bigint NOT NULL REFERENCES site(site_id),
    label       text NOT NULL,
    product     text NOT NULL CHECK (product IN ('Blend','Diesel','Ethanol','Petrol')),
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, label)
);

-- A site's competitor stations (the remembered set the price form preloads).
CREATE TABLE IF NOT EXISTS site_competitor (
    competitor_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id     bigint NOT NULL REFERENCES site(site_id),
    name        text NOT NULL,
    brand       text,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, name)
);

-- Both are audited master data (every change attributable; deletes blocked).
DROP TRIGGER IF EXISTS t_audit ON site_tank;
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON site_tank
    FOR EACH ROW EXECUTE FUNCTION da_audit('label');
DROP TRIGGER IF EXISTS t_audit ON site_competitor;
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON site_competitor
    FOR EACH ROW EXECUTE FUNCTION da_audit('name');

-- Grants for the app role.
GRANT SELECT, INSERT, UPDATE ON site_tank, site_competitor TO da_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app;

COMMIT;
