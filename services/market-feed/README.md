# market-feed

TradingView-1 보조 데이터 수집 서비스 (Python).

## 역할

Node.js Chart 앱이 다루지 못하는 데이터를 배치로 수집해 VM1 TimescaleDB에 upsert.

- **pykrx 전용 항목** — 공매도 잔고, 신용잔고, 일부 섹터 지수
- **정기 배치 잡** — 장 마감 후 일간 수급/시총/거래대금 갱신
- **yfinance 누적** — 미국 선물·VIX·DXY 1분봉 (30일 롤링 → 장기 저장)

## 아키텍처

- **APScheduler** BlockingScheduler — 단일 프로세스로 크론 잡 관리
- **psycopg2** 또는 `psycopg[binary]` — TimescaleDB 직접 쓰기
- **DB 연결**: `DATABASE_URL` (trading_app 유저) via Tailscale IP
- **컨테이너**: VM1에서 `docker compose up -d market-feed` (별도 서비스로 추가)

## 현재 상태 (Phase 1)

**골격만 구성됨.** 실제 수집 로직은 Phase 2에서 구현.

- [x] 디렉터리 구조
- [x] Dockerfile + requirements.txt
- [x] APScheduler 메인 루프
- [x] placeholder fetchers (빈 함수)
- [ ] pykrx 실제 호출 (Phase 2)
- [ ] 에러 핸들링/재시도/알림 (Phase 2)
- [ ] 로깅 (Phase 2 — 구조화 로그 + VM1 로그 rotation)

## 실행 (개발)

```bash
cd services/market-feed
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL="postgres://trading_app:***@100.104.211.62:5432/trading"
python -m market_feed.main
```

## 실행 (VM1 배포 — Phase 2)

```bash
# infra/docker-compose.yml에 market-feed 서비스 섹션 추가 후
docker compose up -d market-feed
docker compose logs -f market-feed
```

## 스케줄 (계획)

| 잡 | cron | 내용 |
|----|------|------|
| `flows_daily` | `30 16 * * 1-5` (KST) | 일간 수급 (외국인/기관/개인) |
| `market_cap_update` | `40 16 * * 1-5` | 시총·거래대금 갱신 |
| `shorting_balance` | `0 17 * * 1-5` | 공매도 잔고 (일간 공시) |
| `credit_balance` | `0 18 * * 1` | 신용잔고 (주간 공시) |
| `halt_check` | `*/30 9-15 * * 1-5` | 거래정지 자동 감지 |
