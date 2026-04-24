# UI MVP Backlog (다음 세션 1순위)

W1 수급 수집이 백그라운드 cron으로 돌아가는 동안, 프론트엔드에서 221 종목 유니버스를 실제로 탐색·차트 전환 가능한 UI를 만든다.

## 목표

좌측 종목 리스트 + 검색 + 티어 탭, 우측 캔들 차트 + 타임프레임 토글. 지금 차트(1종목 고정)에서 → **221개를 실시간으로 전환**할 수 있는 플랫폼으로 승격.

## 파일 구조

```
src/
├── app/
│   ├── page.tsx                          ← 레이아웃 개편 (좌: 목록, 우: 차트)
│   └── api/
│       ├── symbols/search/route.ts       ← 종목 자동완성 (이름/코드 부분검색)
│       ├── symbols/list/route.ts         ← 티어/섹터 필터 리스트
│       └── candles/route.ts              ← 기존 (재사용)
├── components/
│   ├── SymbolSearch.tsx                  ← 검색창 (debounce + 자동완성 드롭다운)
│   ├── SymbolList.tsx                    ← 티어 S/A/B 탭 + 섹터 그룹핑
│   ├── TierBadge.tsx                     ← S/A/B 색상 구분 뱃지
│   ├── TimeframeToggle.tsx               ← 1m/5m/15m/1H/1D 전환 (Chart.tsx에서 추출)
│   └── Chart.tsx                         ← 기존 (symbol prop 기반으로 이미 동작)
└── hooks/
    ├── useSymbols.ts                     ← 검색/리스트 SWR or TanStack Query
    └── useCandles.ts                     ← 현재 useEffect 로직 추출
```

## 예상 소요

하루(~8시간).

## API 설계 초안

### `GET /api/symbols/search?q=<query>&limit=10`
- q가 6자리 숫자면 code 정확 매칭 + prefix 매칭
- q가 한글/영문이면 `symbols.name ILIKE %q%` + 활성 유니버스 우선
- 응답: `{ symbols: [{ code, name, market, tier, sector }] }`

### `GET /api/symbols/list?tier=A&sector=반도체&limit=50`
- tier (S/A/B) 필터 (없으면 S+A+B 전체)
- sector 필터 (옵션)
- 응답: `{ symbols: [...], bySector: { "반도체": 12, ... } }`

## 상호작용 흐름

1. 초기 로드: `page.tsx`가 `searchParams.symbol`에서 현재 종목 읽음 (없으면 005930)
2. 좌측 `SymbolList`: B 티어 전체 + 섹터 그룹으로 표시. 클릭 시 `router.push(?symbol=XXXXXX&tf=5m)`
3. `SymbolSearch`: 상단 고정. 입력 300ms debounce → `/api/symbols/search` → 드롭다운. 선택 시 URL 업데이트
4. 우측 `Chart`: 현재 symbol/interval 기반으로 그대로 렌더 (이미 동작)
5. `TimeframeToggle`: 현재 Chart.tsx 내부 dropdown을 별도 컴포넌트로 추출 (재사용성)

## 우선순위 제안 (하루 안에 끝낼 순서)

1. **API 2개** (`/api/symbols/search`, `/api/symbols/list`) — 1h
2. **레이아웃 개편** (`page.tsx` grid 2-col) — 30min
3. **SymbolList 컴포넌트** (티어 탭 + 섹터 그룹) — 2h
4. **SymbolSearch 컴포넌트** (debounce + keyboard nav) — 2h
5. **TierBadge / TimeframeToggle 추출** — 1h
6. **hooks 추출 + cleanup** — 1h

남은 시간은 버그 수정·모바일 대응.

## 왜 Phase 1 수급 수집보다 UI 먼저가 괜찮은가

- Phase 1 fetcher (`src/lib/kis/investor-flows.ts` + cron)는 이미 구현됨. 남은 건 검증·튜닝으로 **시간보다는 대기**의 영역 (장 마감 후 실데이터 검증, 며칠간 모니터).
- UI는 사용자가 **직접 손으로 돌려보며 피드백**을 주는 영역 → 동기 작업.
- UI가 완성되면 221 종목이 실제로 탐색 가능한 살아있는 앱이 되고, 수급 데이터는 나중에 차트 밑에 겹쳐 시각화 가능.

## 다음 세션 시작 시 추천 순서

1. **004 마이그레이션 적용** (5분, 미적용 상태면)
2. **W1 dry-run 검증** (10분, 단일 종목으로 API 응답 구조 확인)
3. **UI MVP 구축** (하루)
4. (병행 가능) W1 전 종목 수집 cron 등록
