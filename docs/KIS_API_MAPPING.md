# KIS API Endpoint Mapping (Phase 1 데이터 소스)

KIS OpenAPI 공식 엑셀 문서 전체(338 endpoint) 파싱 후 확정된 맵. **모든 Phase 1 데이터 항목이 KIS에 존재**함이 확인되어 pykrx · FinanceDataReader 의존성 완전 폐기, Node/TS 단일 스택으로 통일.

원본 엑셀: 사용자 로컬 (파일명 `[국내주식] 기본시세.xlsx` 등).
최종 확정일: 2026-04-24.

## 🔴 최우선 (Phase 1 Core)

| 용도 | TR_ID | API 명 | Path 힌트 |
|------|-------|--------|----------|
| 일간 수급 (종목별 투자자) | `FHPTJ04160001` | 종목별 투자자매매동향(일별) | `/uapi/domestic-stock/v1/quotations/...` (경로 검증 필요) |
| 외국계 순매수 추이 | `FHKST644400C0` | 종목별 외국계 순매수추이 | 보완용 |
| 투자자별 현재가 | `FHKST01010900` | 주식현재가 투자자 | 실시간 보조 |
| 외인/기관 집계 | `FHPTJ04400000` | 국내기관_외국인 매매종목가집계 | 상위 랭킹용 |
| 10호가 + 예상체결 | `FHKST01010200` | 주식현재가 호가/예상체결 | **이미 구현됨** |

## 🟠 고가치

| 용도 | TR_ID | API 명 |
|------|-------|--------|
| 업종 분봉 | `FHKUP03500200` | 업종 분봉조회 |
| 업종 일봉 | `FHKUP03500100` | 국내주식업종기간별시세 |
| 업종 현재지수 | `FHPUP02100000` | 국내업종 현재지수 |
| 업종 분별 시간별 | `FHPUP02110200` | 국내업종 시간별지수(분) |
| 체결강도 상위 | `FHPST01680000` | 국내주식 체결강도 상위 |
| 공매도 일별 추이 | `FHPST04830000` | 국내주식 공매도 일별추이 |
| 공매도 상위 | `FHPST04820000` | 국내주식 공매도 상위종목 |

## 🟢 실시간 (WebSocket)

| 용도 | TR_ID | API 명 |
|------|-------|--------|
| 실시간 호가 | `H0STASP0` / `H0UNASP0` | 국내주식 실시간호가 (KRX / 통합) |
| 실시간 체결 | `H0UPCNT0` / `H0STANC0` | 국내주식 실시간체결 |
| 실시간 프로그램매매 | `H0STPGM0` / `H0UNPGM0` | 실시간 프로그램매매 |
| 실시간 NAV | `H0STNAV0` | 국내 ETF NAV 추이 |

WS 엔드포인트: `ws://ops.koreainvestment.com:21000` (실전) / `:31000` (모의). 승인키 발급은 `/oauth2/Approval`.
구독 슬롯 ~40개 제한 → Tier S (5~20종목)에만 적용.

## 🟡 중요

| 용도 | TR_ID | API 명 |
|------|-------|--------|
| 신용잔고 일별 | `FHPST04760000` | 국내주식 신용잔고 일별추이 |
| 신용잔고 상위 | `FHKST17010000` | 국내주식 신용잔고 상위 |
| 프로그램매매(일별) | `FHPPG04600001` | 프로그램매매 종합현황(일별) |
| 종목 프로그램매매 | `FHPPG04650201` | 종목별 프로그램매매추이(일별) |
| VI 상태 | `FHPST01390000` | 변동성완화장치(VI) 현황 |
| 시황·공시 | `FHKST01011800` | 종합 시황/공시(제목) |
| ETF NAV (분/일/초) | `FHPST02440000` / `FHPST02440100` / `FHPST02440200` | NAV 비교추이 |

## 이미 구현된 것 (참조)

| 용도 | TR_ID | 파일 |
|------|-------|------|
| 당일 1분봉 | `FHKST03010200` | `src/lib/kis/candles.ts` `fetchMinuteChunk` |
| 과거일 1분봉 | `FHKST03010230` | `src/lib/kis/candles.ts` `fetchMinuteBarsForDate` |
| 일/주/월/년봉 | `FHKST03010100` | `src/lib/kis/candles.ts` `fetchDailyBars` |
| ETF 구성종목 | `FHKST121600C0` | `src/lib/kis/etf.ts` `fetchEtfComponents` (상위 30만 반환 — KOSPI200 전체는 MST 파일 사용) |
| 종목 마스터 | (kospi_code.mst 다운로드) | `scripts/parse_kospi_mst.py` |

## 공통 호출 규칙

모든 KIS REST 호출은 이 레이어를 거친다:
- URL: `https://openapi.koreainvestment.com:9443` (실전) 또는 모의투자 엔드포인트
- Auth: `src/lib/kis/token.ts` 하이브리드 토큰 로더 (env → disk cache → auto-refresh)
- Headers 공통:
  - `content-type: application/json; charset=utf-8`
  - `authorization: Bearer <token>`
  - `appkey`, `appsecret` (env)
  - `tr_id: <위 표 참조>`
  - `custtype: P` (개인)
- Rate limit: 초당 20 TPS, 엔드포인트당 300ms throttle 권장 (이미 `src/lib/kis/candles.ts`에서 `KIS_CHUNK_DELAY_MS=300` 적용)

## 새 fetcher 추가 시 체크리스트

1. `src/lib/kis/<domain>.ts` 파일 생성 (예: `flows.ts`, `shorts.ts`, `credits.ts`, `program.ts`, `sectors.ts`)
2. Path + TR_ID 확정 — 위 표 참조, 엑셀에서 정확한 URL path 재확인
3. Response 필드 TypeScript 타입화
4. 300ms throttle (다중 호출 시)
5. DB 저장 테이블 — 새 마이그레이션 필요하면 `infra/migrations/NNN_<name>.sql`
6. Schedule — OS cron 또는 Node cron으로 호출 (아래 스케줄링 섹션 참조)

## Phase 1 구현 로드맵 (확정)

### W1 (3~4일) — 일간 수급
- `infra/migrations/004_flows_daily.sql` + `symbols.market_cap` 자동 갱신
- `src/lib/kis/investor-flows.ts` (FHPTJ04160001)
- `scripts/collect-flows-daily.ts` (장마감 후 크론)
- 검증: 어제 데이터 수집 후 BT-02 결과와 대조

### W2 (3일) — 호가 + 체결강도
- `infra/migrations/005_orderbook_snapshots.sql`
- `src/lib/kis/orderbook.ts` (FHKST01010200, 10호가)
- `candles_1m`에 `trade_strength` 컬럼 추가
- 관심종목 30종목 샘플링

### W3 (3일) — 섹터 지수
- `infra/migrations/006_sector_indices.sql` (TimescaleDB hypertable)
- `src/lib/kis/sector-index.ts` (FHKUP03500200, 분봉)
- `scripts/collect-sector-indices.ts`
- KRX 섹터 10개 스트림

### W4 (2~3일) — 공매도 + 신용
- `infra/migrations/007_shorts.sql` + `008_credit.sql`
- `src/lib/kis/shorts.ts` (FHPST04830000)
- `src/lib/kis/credit.ts` (FHPST04760000)
- 주간 수집 크론

## 스케줄링 (결정 필요)

현재는 `services/market-feed/` Python 골격이 있으나, 모든 fetcher가 Node로 오면 이 컨테이너가 **얇은 Node cron runner**로 대체 가능. 선택지:

- **A. systemd timers on VM1** — 정적, 재부팅 자동 복구, 로그 journalctl
- **B. Node 컨테이너 + node-cron 내장** — 단일 프로세스로 모든 잡 실행
- **C. pg_cron 확장** — DB 레벨 스케줄, 각 잡이 HTTP 트리거
- **D. Route Handler + 외부 cron** (curl로 Next.js 경로 호출) — 빠르게 시작 가능

우선 D로 빠르게 시작하고, 안정화되면 B로 이관 권장.
