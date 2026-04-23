-- 002_universe_ascii.sql
-- ASCII-only rewrite for PowerShell pipe safety.
-- No Korean comments anywhere. Safe for Windows stdout encoding.

-- symbols
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

-- universe: drop and recreate to ensure source column exists
DROP TABLE IF EXISTS universe CASCADE;

CREATE TABLE universe (
  code            text NOT NULL REFERENCES symbols(code),
  tier            text NOT NULL CHECK (tier IN ('S', 'A', 'B')),
  included_on     date NOT NULL,
  excluded_on     date,
  source          text NOT NULL,
  note            text,
  PRIMARY KEY (code, tier, included_on)
);

CREATE INDEX universe_active
  ON universe (tier, code) WHERE excluded_on IS NULL;

CREATE INDEX universe_time_range
  ON universe (included_on, excluded_on);

-- universe_history
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

-- grants
GRANT SELECT, INSERT, UPDATE, DELETE ON symbols TO trading_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON universe TO trading_app;
GRANT SELECT, INSERT ON universe_history TO trading_app;
GRANT USAGE, SELECT ON SEQUENCE universe_history_id_seq TO trading_app;

-- verify
\d universe
