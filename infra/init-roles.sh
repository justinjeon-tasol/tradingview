#!/bin/bash
# TradingView-1 앱 유저 생성 + 공용 접근 차단.
#
# 실행 시점: docker-entrypoint가 POSTGRES_DB(=trading)을 자동 생성한 직후.
# 파일명 접두어 05 → 10 순서로 init.sql 보다 먼저 실행된다.
#
# 목적:
# - 앱(Next.js)은 superuser 'postgres'를 쓰지 않고 전용 'trading_app' 유저로만 접속.
# - 나중에 SaaS(loanapp)가 같은 Postgres 인스턴스에 추가돼도 DB 간 상호 접근 차단.

set -e

: "${TRADING_APP_PASSWORD:?TRADING_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  -- 앱 전용 유저 (superuser 아님, 로그인만 가능)
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trading_app') THEN
      CREATE ROLE trading_app WITH LOGIN PASSWORD '${TRADING_APP_PASSWORD}';
    ELSE
      ALTER ROLE trading_app WITH LOGIN PASSWORD '${TRADING_APP_PASSWORD}';
    END IF;
  END
  \$\$;

  -- trading DB 공용 접근 차단 (Phase 2에서 loanapp_app 유저가 생겨도 붙지 못함)
  REVOKE ALL ON DATABASE trading FROM PUBLIC;
  REVOKE CONNECT ON DATABASE trading FROM PUBLIC;

  -- trading_app 유저에게만 trading DB 접근 허용
  GRANT CONNECT ON DATABASE trading TO trading_app;
EOSQL

echo "[init-roles] trading_app role ready, PUBLIC access to trading DB revoked"
