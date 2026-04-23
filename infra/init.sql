-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1분봉 원본 테이블 (5m/10m/… 집계는 뷰 또는 온더플라이로 처리)
CREATE TABLE IF NOT EXISTS candles_1m (
  symbol      text NOT NULL,
  time_utc    timestamptz NOT NULL,
  open        numeric(18,4) NOT NULL,
  high        numeric(18,4) NOT NULL,
  low         numeric(18,4) NOT NULL,
  close       numeric(18,4) NOT NULL,
  volume      bigint NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, time_utc)
);

-- TimescaleDB 하이퍼테이블 변환 (7일 청크 단위 파티셔닝)
SELECT create_hypertable(
  'candles_1m',
  'time_utc',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '7 days'
);

-- 최신 데이터 역순 조회 가속
CREATE INDEX IF NOT EXISTS candles_1m_symbol_time_desc
  ON candles_1m (symbol, time_utc DESC);

-- 패치 이력 요약 (어느 종목/구간까지 KIS에서 당겨왔는지 추적)
CREATE TABLE IF NOT EXISTS candles_fetch_log (
  id          bigserial PRIMARY KEY,
  symbol      text NOT NULL,
  interval    text NOT NULL,
  from_utc    timestamptz NOT NULL,
  to_utc      timestamptz NOT NULL,
  bar_count   integer NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candles_fetch_log_symbol_fetched_at
  ON candles_fetch_log (symbol, fetched_at DESC);

-- -----------------------------------------------------------------------------
-- candles_daily — 일봉 원본. 10일봉/월봉은 이 테이블에서 집계.
-- KIS inquire-daily-itemchartprice (TR FHKST03010100) 응답 매핑.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candles_daily (
  symbol      text NOT NULL,
  period      text NOT NULL,
  trade_date  date NOT NULL,
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

-- -----------------------------------------------------------------------------
-- symbols / universe / universe_history — 종목 마스터 + 티어링
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

CREATE TABLE IF NOT EXISTS universe (
  code            text NOT NULL REFERENCES symbols(code),
  tier            text NOT NULL CHECK (tier IN ('S', 'A', 'B')),
  included_on     date NOT NULL,
  excluded_on     date,
  source          text NOT NULL,
  note            text,
  PRIMARY KEY (code, tier, included_on)
);

CREATE INDEX IF NOT EXISTS universe_active
  ON universe (tier, code) WHERE excluded_on IS NULL;
CREATE INDEX IF NOT EXISTS universe_time_range
  ON universe (included_on, excluded_on);

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
-- poll_cursors  (generic key/value cursor store for polling workers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_cursors (
  key         text PRIMARY KEY,
  last_seen   timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- trading_app 유저 권한 부여
-- (trading_app 역할은 05-init-roles.sh에서 먼저 생성됨)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO trading_app;
GRANT CREATE ON SCHEMA public TO trading_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON candles_1m TO trading_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON candles_daily TO trading_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON candles_fetch_log TO trading_app;
GRANT USAGE, SELECT ON SEQUENCE candles_fetch_log_id_seq TO trading_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON symbols TO trading_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON universe TO trading_app;
GRANT SELECT, INSERT ON universe_history TO trading_app;
GRANT USAGE, SELECT ON SEQUENCE universe_history_id_seq TO trading_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON poll_cursors TO trading_app;

-- 이후 public 스키마에 생기는 테이블/시퀀스에도 자동 부여
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO trading_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO trading_app;
