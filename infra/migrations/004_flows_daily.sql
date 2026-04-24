-- 004_flows_daily.sql
-- Investor trading flows per stock per day (BT-06 data source)
-- Source: KIS FHPTJ04160001 (종목별 투자자매매동향 일별)
--
-- Unit normalization:
--   KIS returns volumes in shares (주) and amounts in MILLION KRW (백만원).
--   We normalize amounts to WON (원) by multiplying by 1_000_000 before insert.
--   Negative values = net seller, positive = net buyer.
--
-- Apply:
--   cat 004_flows_daily.sql | ssh arm-server-01 "sudo docker exec -i tv1-pg psql -U postgres -d trading"

-- -----------------------------------------------------------------------------
-- flows_daily — 종목 × 일자 단위 투자자별 수급
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flows_daily (
  date                        date NOT NULL,
  code                        text NOT NULL REFERENCES symbols(code),

  -- 투자자별 순매수 (normalized to KRW)
  foreign_net_qty             bigint,                         -- 외국인 순매수 수량 (주)
  foreign_net_value           bigint,                         -- 외국인 순매수 거래대금 (원)
  institution_net_qty         bigint,                         -- 기관계 순매수 수량
  institution_net_value       bigint,                         -- 기관계 순매수 거래대금 (원)
  individual_net_qty          bigint,                         -- 개인 순매수 수량
  individual_net_value        bigint,                         -- 개인 순매수 거래대금 (원)

  -- 외국인 세부 (등록/비등록)
  foreign_reg_net_qty         bigint,                         -- 외국인 등록 순매수 수량
  foreign_reg_net_value       bigint,                         -- 외국인 등록 순매수 대금 (원)
  foreign_nreg_net_qty        bigint,                         -- 외국인 비등록 순매수 수량
  foreign_nreg_net_value      bigint,                         -- 외국인 비등록 순매수 대금 (원)

  -- 기관 세부 (세분화 — BT-06 확장용)
  inst_securities_net_value   bigint,                         -- 증권
  inst_trust_net_value        bigint,                         -- 투자신탁
  inst_privfund_net_value     bigint,                         -- 사모펀드
  inst_bank_net_value         bigint,                         -- 은행
  inst_insurance_net_value    bigint,                         -- 보험
  inst_merbank_net_value      bigint,                         -- 종금
  inst_pension_net_value      bigint,                         -- 기금
  inst_other_net_value        bigint,                         -- 기타 (단체 포함)
  etc_corp_net_value          bigint,                         -- 기타 법인

  -- 당일 거래 요약 (검증/디버그용)
  close_price                 integer,                        -- 종가
  volume                      bigint,                         -- 거래량 (주)
  value                       bigint,                         -- 거래대금 (원)

  -- 메타
  source                      text NOT NULL DEFAULT 'kis:FHPTJ04160001',
  fetched_at                  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (date, code)
);

-- TimescaleDB hypertable (30일 청크 — 수급은 일봉 대비 가벼워서 큰 청크)
SELECT create_hypertable(
  'flows_daily',
  'date',
  chunk_time_interval => INTERVAL '30 days',
  if_not_exists => TRUE
);

-- 종목별 역순 조회 가속 (BT-06에서 특정 종목의 최근 수급 조회)
CREATE INDEX IF NOT EXISTS flows_daily_code_date_desc
  ON flows_daily (code, date DESC);

-- 날짜별 전 종목 조회 (일간 리뷰용)
CREATE INDEX IF NOT EXISTS flows_daily_date_desc
  ON flows_daily (date DESC);


-- -----------------------------------------------------------------------------
-- flows_daily_log — 수집 감사 로그
-- 매 cron 실행 후 coverage와 실패 종목 기록
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flows_daily_log (
  id              bigserial PRIMARY KEY,
  date            date NOT NULL,
  coverage        int NOT NULL,                               -- 성공 수집 종목 수
  expected        int NOT NULL,                               -- 대상 유니버스 크기
  failed_codes    text[] DEFAULT '{}',                        -- 실패 종목 리스트
  duration_ms     int,                                        -- 전체 소요 시간
  source          text NOT NULL DEFAULT 'cron:flows-daily',
  triggered_by    text,                                       -- 'cron' | 'manual' | 'backfill'
  attempt         int NOT NULL DEFAULT 1,                     -- 재시도 횟수
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS flows_daily_log_date_desc
  ON flows_daily_log (date DESC);


-- -----------------------------------------------------------------------------
-- 권한 (trading_app)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON flows_daily TO trading_app;
GRANT SELECT, INSERT ON flows_daily_log TO trading_app;
GRANT USAGE, SELECT ON SEQUENCE flows_daily_log_id_seq TO trading_app;


-- -----------------------------------------------------------------------------
-- 검증 쿼리 (적용 후 수동 실행)
-- -----------------------------------------------------------------------------
-- 1) 스키마 확인:
--    \d flows_daily
--    \d flows_daily_log
--
-- 2) 하이퍼테이블 확인:
--    SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name='flows_daily';
--
-- 3) 권한 확인:
--    \dp flows_daily
