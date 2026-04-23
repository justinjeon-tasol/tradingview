# TradingView-1 — 구현된 기능 목록

> 이 문서는 프로젝트에 실제로 구현되어 동작하는 기능만 기록합니다.
> 새 기능 완료 시 즉시 추가. 기획/미구현 항목은 넣지 않습니다.
> 마지막 업데이트: 2026-04-24 (Supabase trades 폴러 실동작화)

---

## 차트 UI

- **lightweight-charts v5 기반 캔들+볼륨 차트** — TradingView 스타일 다크 테마, autoSize, 크로스헤어, rightOffset 12bar 여백으로 last-value 배지 겹침 방지. (`src/components/Chart.tsx`)
- **타임프레임 셀렉터 (드롭다운)** — `분봉 (1분/5분/15분/30분/1시간)` · `일봉 이상 (1일/10일/1달)` optgroup 분리, 선택 시 URL `?tf=` 동기화. (`src/components/Chart.tsx`, `src/lib/timeframes.ts`, `src/app/page.tsx`)
- **가격 스케일 포맷** — 정수 반올림 + 천단위 콤마 (`Intl.NumberFormat('ko-KR')`). 가격축 틱·last-value·크로스헤어 모두 적용. 볼륨은 기본 `K/M` 압축 포맷 유지. (`src/components/Chart.tsx` `localization.priceFormatter`)
- **파란 크로스헤어 라벨** — 마우스 위치 축 라벨 배경 `#2962FF` (TradingView 블루). (`crosshair.{vertLine,horzLine}.labelBackgroundColor`)
- **무한 스크롤 프리펜드** — 차트 왼쪽 끝 15 bar 이내 근접 시 직전 거래일 자동 로드. 중복 호출 방지, 최대 7일 한도, "과거 데이터 불러오는 중…" 인디케이터. (`src/components/Chart.tsx`)
- **상태 인디케이터** — loading / live(●) / error 배지, `심볼 · 인터벌 · N bars` 메타. (`src/components/Chart.tsx`)

## 데이터 소스 — KIS OpenAPI (한국투자증권)

- **토큰 하이브리드 로더** — env → 디스크 캐시(`.kis-token-cache.json`) → `/oauth2/tokenP` 자동 발급/갱신. 만료 60초 전 선제 갱신, 동시 요청 inflight 병합. (`src/lib/kis/token.ts`)
- **당일 1분봉 페이지네이션** — `FHKST03010200` 사용, 30개씩 역방향 페이징, 300ms throttle, 장 마감 후엔 15:30 기준으로 클램프. (`fetchOneMinuteBars` in `src/lib/kis/candles.ts`)
- **과거 1분봉 가져오기** — `FHKST03010230` (inquire-time-dailychartprice) 사용, 특정 날짜(YYYYMMDD)의 하루치 1분봉 전부. (`fetchMinuteBarsForDate` in `src/lib/kis/candles.ts`)
- **일봉 가져오기** — `FHKST03010100` (inquire-daily-itemchartprice) 사용, 날짜 범위로 최대 100개 일봉 반환. 수정주가 기본. (`fetchDailyBars` in `src/lib/kis/candles.ts`)
- **임의 간격 집계** — 인트라데이: 1m, 3m, 5m, 10m, 15m, 30m, 60m (1분봉에서 집계). 일봉기반: 1d, 10d(10거래일 묶음), 1mo(YYYY-MM 그룹). (`aggregateToInterval`, `aggregateDailyTo10d`, `aggregateDailyToMonthly`)
- **한국 거래일 유틸** — 주말 스킵한 직전 거래일 계산. (`previousTradingDateYYYYMMDD`)

## 저장소 — OCI VM1 (TimescaleDB + Redis)

- **Docker Compose 스택** — TimescaleDB pg16 (hypertable, 7일 청크) + Redis 7-alpine. Tailscale 프라이빗 네트워크만 허용, 공용 노출 차단. (`infra/docker-compose.yml`)
- **Postgres 유저 격리** — superuser `postgres` / 앱 유저 `trading_app` (CRUD 권한만). SaaS 워크로드용 DB 격리 준비. (`infra/init-roles.sh`, `infra/init.sql`)
- **하이퍼테이블 스키마** — `candles_1m (symbol, time_utc, OHLCV, fetched_at)` (TimescaleDB 하이퍼테이블) + `candles_daily (symbol, period, trade_date, OHLCV)` + `candles_fetch_log`. (`infra/init.sql`, `infra/migrations/001_candles_daily.sql`)
- **DB 클라이언트** — `postgres` (porsager) 드라이버, HMR-safe 싱글톤 풀. (`src/lib/db/pool.ts`)
- **캔들 레포** — 인트라데이: `selectBars`, `upsertBars`, `earliestBarTime`, `latestBarTime`. 일봉: `selectDailyBars`, `upsertDailyBars`, `earliestDailyDate`, `latestDailyDate`. 공통: `logFetch`. (`src/lib/db/candles.ts`)

## API — Next.js Route Handler

- **`GET /api/candles`** — DB-first 조회, 캐시 미스 시 KIS 호출 → upsert → 반환. interval 타입에 따라 인트라데이/일봉 분기. (`src/app/api/candles/route.ts`)
  - `?symbol=` (6자리 KRX 코드, 기본 `005930`)
  - `?interval=` (인트라데이: `1m/5m/15m/30m/60m` · 일봉: `1d/10d/1mo`, 기본 `5m`)
  - `?before=<unix_sec>` — 지정 시점 직전 데이터 로드 (무한 스크롤용)
  - 인트라데이: 최대 7일 히스토리, 장중 10분 이상 stale 시 자동 재패치
  - 일봉: 최근 1년치 로드, 7일 이상 stale 시 재패치
  - 응답에 `kind: "intraday" | "daily"` 포함

## 유니버스 관리

- **종목 마스터 스키마** — `symbols(code, name, market, sector, tags, is_etf, tradable, trading_status, listed_on, delisted_on, market_cap, avg_daily_value)`. 단순 메타 + 시총/거래대금/거래상태. (`infra/init.sql`, `infra/migrations/002_universe.sql`)
- **티어링 스키마** — `universe(code, tier(S/A/B), included_on, excluded_on, source, note)` + `universe_history(id, code, old_tier, new_tier, reason, changed_by)` append-only 감사로그.
- **DB repo** — `upsertSymbol`, `addToUniverse`, `removeFromUniverse`, `activeUniverse`, `symbolByCode`. (`src/lib/db/universe.ts`)
- **CLI 초기 로더** — `npm run universe:load` (기본 `data/seed/universe_expanded.json`의 79종목 → B 티어 `source='manual'` 편입). (`scripts/universe-load.ts`)
- **CLI 티어 조작** — `npm run universe:tier -- --code 005930 --tier A --reason weekly_rebalance` / `--remove` / `--list`. A 승격 시 tradable·market_cap(500억)·listed_on(180일) 검증, `--force`로 우회 가능. (`scripts/universe-tier.ts`)
- **Python `services/market-feed/` 골격** — Dockerfile + APScheduler + placeholder fetchers (flows_daily / shorting / credit_balance / halt_check). 크론 등록만, 실수집은 Phase 2.
- **KOSPI200/KOSDAQ150 fetcher (Python pykrx)** — `scripts/fetch_kospi200.py`로 지수 구성종목을 `data/seed/<index>.json`에 저장. `npm run universe:load:kospi200` / `:kosdaq150`으로 B 티어 편입. 리밸런싱 스냅샷 재실행 가능. (pip install pykrx 필요)
- **승격·강등 훅** — `src/lib/universe/hooks.ts`: `onSignalBuy` (S 임시 승격, 1h), `onTradeExecuted` (S 고정), `onPositionClosed` (청산 마커), `demoteStaleSTier` (cron용 자동 강등). universe_history에 감사 이력 기록.
- **훅 테스트 CLI** — `npm run hook:test -- --event signal-buy --code 005930` 등으로 수동 트리거 가능.
- **Trades poller (실동작)** — `scripts/trades-poll.ts`: Supabase `trades`(BUY) + `positions`(CLOSED) 30초 폴링. `signal_source='KIS_SYNC'` 아티팩트 제외 필터. 훅 자동 호출. 커서는 TimescaleDB `poll_cursors` 테이블에 저장 (다중 인스턴스 안전). `--once` / `--dry-run` / `--since` / `--interval` 옵션 지원.

## 인프라 & 보안

- **Tailscale 프라이빗 네트워크** — VM1 (100.104.211.62) ↔ Windows 개발 머신 (100.84.139.36). DB/Redis는 Tailscale IP 바인딩, 공용 포트 노출 없음.
- **환경변수 분리** — `.env.local` (앱), `infra/.env` (Postgres/Redis 비밀번호), `.kis-token-cache.json` 모두 `.gitignore` 처리.
- **KIS 레이트 리밋 대응** — 연속 KIS 호출 사이 300ms 슬립 (`EGW00201: 초당 거래건수 초과` 방지).

## 개발 환경

- **Next.js 15 App Router + TypeScript + Tailwind** — 다크 테마 기본, `src/` 구조, `@/` 경로 alias. (`package.json`, `tsconfig.json`)
- **npm 전용** — pnpm/yarn/bun 사용 안 함.

---

## 변경 로그

### 2026-04-24 — Supabase trades 폴러 실동작화
- `scripts/trades-poll.ts` 실구현 — trades(BUY, `signal_source != 'KIS_SYNC'` 필터) + positions(CLOSED) 병렬 폴링
- `infra/migrations/003_poll_cursors.sql` — `poll_cursors` 키/밸류 테이블 추가 (커서 영속화)
- 네이티브 fetch로 Supabase REST 호출 (추가 의존성 X)
- `--once / --dry-run / --since / --interval` 옵션

### 2026-04-24 — KOSPI200 fetcher + 승격/강등 훅
- `scripts/fetch_kospi200.py` — pykrx로 KOSPI200/KOSDAQ150 구성종목 JSON 생성. meta 블록에 as_of_date 기록
- `npm run universe:load:kospi200` / `universe:load:kosdaq150` — 생성된 JSON을 B 티어로 편입
- `src/lib/universe/hooks.ts` — onSignalBuy / onTradeExecuted / onPositionClosed / demoteStaleSTier
- `scripts/hook-test.ts` + `npm run hook:test` — 훅 수동 트리거

### 2026-04-24 — 마이그레이션 ASCII 정책 (재발 방지)
- 001/002 마이그레이션 SQL의 한글 주석을 영문으로 전환 (PowerShell Get-Content CP949 오독 이슈로 컬럼 누락 재현됨)
- RUNBOOK에 `Get-Content -Encoding UTF8` 주의사항 추가
- 메모리 feedback 등록

### 2026-04-24 — 유니버스 관리 스키마 + Python 골격
- `symbols` + `universe` + `universe_history` 3 테이블, constraints (ETF/tradable/상태) 포함
- `src/lib/db/universe.ts` DB repo — upsert/add/remove/list
- `npm run universe:load` CLI — `data/seed/universe_expanded.json`(79종목) → B 티어 편입
- `npm run universe:tier` CLI — 수동 티어 조작 + A 승격 검증 (시총 500억 / 상장 180일 / tradable)
- `services/market-feed/` Python 서비스 골격 — Dockerfile + APScheduler + placeholder (실수집 Phase 2)
- `infra/migrations/002_universe.sql` 마이그레이션

### 2026-04-24 — TF 드롭다운 + 가격 포맷 + 파란 크로스헤어
- 버튼 그룹 → `<select>` 드롭다운으로 변경 (분봉 / 일봉 이상 optgroup 구분)
- 가격 스케일을 `Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })`로 포맷 (예: `224,500`)
- 크로스헤어 라벨 배경 `#2962FF` (파란색) — 마우스 hover 시 가격·시간 라벨이 파란 뱃지로 표시

### 2026-04-24 — 일봉·10일봉·1달봉 추가
- 새 테이블 `candles_daily (symbol, period, trade_date, OHLCV)` + 인덱스, `trading_app` GRANT
- `infra/migrations/001_candles_daily.sql` 마이그레이션 파일 (볼륨 초기화 이후 적용용)
- `fetchDailyBars()` — KIS `FHKST03010100` (inquire-daily-itemchartprice) 연동, 100일치 단발 조회
- `selectDailyBars` / `upsertDailyBars` / `earliestDailyDate` / `latestDailyDate` DB repo 추가
- Route Handler 인트라데이/일봉 분기 — 10d는 10거래일 묶음, 1mo는 YYYY-MM 그룹 집계
- 타임프레임 셀렉터에 `1일 / 10일 / 1달` 3개 추가 (그룹 구분선 포함)

### 2026-04-23 — 타임프레임 셀렉터 + 차트 여백 수정
- `1분 / 5분 / 15분 / 30분 / 1시간` 버튼 그룹 추가, URL `?tf=` 동기화
- 서버/클라이언트 공용 `src/lib/timeframes.ts` 분리
- `rightOffset: 12`, `scaleMargins` 조정으로 last-value 배지가 캔들 위에 겹치던 문제 해결
- 볼륨 last-value 배지 제거 (`lastValueVisible: false`)

### 2026-04-23 — Supabase → OCI VM1 이관 + 무한 스크롤
- TimescaleDB + Redis 스택을 OCI VM1(ARM64, Tailscale)에 배포
- `src/lib/db/` 추가 (postgres 드라이버, candles repo)
- `/api/candles`를 DB-first + KIS fallback으로 재작성
- KIS 과거 분봉 엔드포인트(`FHKST03010230`) 연동
- Chart.tsx에 `subscribeVisibleLogicalRangeChange` 기반 무한 스크롤 프리펜드 추가
- 멀티-워크로드 격리 설계 (trading_app / 향후 loanapp_app DB 분리)

### 2026-04-23 — KIS 당일 분봉 실연동
- KIS 토큰 하이브리드 로더 (env → 디스크 캐시 → 자동 발급)
- `/api/candles` 최초 버전: KIS 당일 1분봉 fetch + 5m 집계
- Chart.tsx를 synthetic 데이터에서 KIS 실데이터로 교체

### 2026-04-23 — 프로젝트 초기 스캐폴드
- Next.js 15 App Router + TypeScript + Tailwind 셋업 (npm)
- lightweight-charts v5 기본 캔들차트 + 볼륨 (365일 랜덤워크 샘플)
