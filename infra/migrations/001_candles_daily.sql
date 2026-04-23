-- 001_candles_daily.sql  (2026-04-23)
-- Daily bars source-of-truth table. 10-day and monthly intervals are aggregated from this.
-- Rows come from KIS endpoint inquire-daily-itemchartprice (TR FHKST03010100).
--
-- Apply (when volume already initialized, since init.sql won't re-run):
--   sudo docker exec -i tv1-pg psql -U postgres -d trading < 001_candles_daily.sql
--
-- NOTE: ASCII-only comments. See 002_universe.sql header for why.

CREATE TABLE IF NOT EXISTS candles_daily (
  symbol      text NOT NULL,
  period      text NOT NULL,   -- 'D' (daily). W/M/Y are server-side aggregated; column kept for future expansion.
  trade_date  date NOT NULL,   -- KRX trading date in KST.
  open        numeric(18,4) NOT NULL,
  high        numeric(18,4) NOT NULL,
  low         numeric(18,4) NOT NULL,
  close       numeric(18,4) NOT NULL,
  volume      bigint NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, period, trade_date)
);

CREATE INDEX IF NOT EXISTS candles_daily_symbol_date_desc
  ON candles_daily (symbol, period, trade_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON candles_daily TO trading_app;
