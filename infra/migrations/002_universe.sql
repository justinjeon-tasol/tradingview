-- 002_universe.sql  (2026-04-24)
-- Symbol master + universe tiering + change audit log.
--
-- Design notes:
--   symbols          - stock metadata (status, market cap, volume). ETFs have tradable=FALSE and are blocked from tier A.
--   universe         - tier (S/A/B) inclusion/exclusion history. Composite key (code, tier, included_on).
--   universe_history - append-only audit log of tier transitions.
--
-- Apply (VM1):
--   sudo docker exec -i tv1-pg psql -U postgres -d trading < 002_universe.sql
--
-- IMPORTANT: ASCII-only comments here. Previously Korean comments in migration files
-- caused corruption when piped through Windows PowerShell 5.1 Get-Content (default
-- encoding misread UTF-8 bytes), dropping columns silently. Keep SQL migrations ASCII.

-- -----------------------------------------------------------------------------
-- symbols
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS symbols (
  code               text PRIMARY KEY,
  name               text NOT NULL,
  market             text NOT NULL CHECK (market IN ('KOSPI', 'KOSDAQ')),
  sector             text,
  tags               text[] DEFAULT '{}',
  is_etf             boolean NOT NULL DEFAULT false,
  tradable           boolean NOT NULL DEFAULT true,
  trading_status     text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (trading_status IN ('ACTIVE', 'HALTED', 'DELISTED')),
  listed_on          date,
  delisted_on        date,
  market_cap         bigint,
  avg_daily_value    bigint,
  last_updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS symbols_market_status
  ON symbols (market, trading_status);
CREATE INDEX IF NOT EXISTS symbols_sector
  ON symbols (sector) WHERE trading_status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- universe
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS universe (
  code            text NOT NULL REFERENCES symbols(code),
  tier            text NOT NULL CHECK (tier IN ('S', 'A', 'B')),
  included_on     date NOT NULL,
  excluded_on     date,
  source          text NOT NULL,
  note            text,
  PRIMARY KEY (code, tier, included_on)
);

-- fast lookup of currently included rows by (tier, code)
CREATE INDEX IF NOT EXISTS universe_active
  ON universe (tier, code) WHERE excluded_on IS NULL;

-- point-in-time reconstruction for backtesting
CREATE INDEX IF NOT EXISTS universe_time_range
  ON universe (included_on, excluded_on);

-- -----------------------------------------------------------------------------
-- universe_history  (append-only audit log)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS universe_history (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL,
  old_tier    text,
  new_tier    text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL,
  changed_by  text NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS universe_history_code_time
  ON universe_history (code, changed_at DESC);
CREATE INDEX IF NOT EXISTS universe_history_reason_time
  ON universe_history (reason, changed_at DESC);

-- -----------------------------------------------------------------------------
-- Privileges (trading_app)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON symbols TO trading_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON universe TO trading_app;
GRANT SELECT, INSERT ON universe_history TO trading_app;
GRANT USAGE, SELECT ON SEQUENCE universe_history_id_seq TO trading_app;
