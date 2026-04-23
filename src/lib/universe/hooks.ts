/**
 * Universe hooks — signal/trade events → tier transitions.
 *
 * 목적: 티어 S(활성 매매)로의 자동 승격·강등을 담당. 외부 이벤트 소스
 * (시그널 엔진, trades 피드)와 universe 테이블 사이의 얇은 레이어.
 *
 * 승격·강등 규칙 (로드맵 기준):
 *   onSignalBuy(code):
 *     signal.BUY 발생 시 1시간 S 임시 승격 → 진입 결정 window 확보
 *     1시간 내 onTradeExecuted 안 오면 자동 A 강등 (이 로직은 cron에서 주기 점검)
 *   onTradeExecuted(code):
 *     매수 체결 확인 → S 고정 유지 (포지션 청산까지)
 *   onPositionClosed(code, at):
 *     청산 후 24h 경과 시 A 강등 (이것도 cron에서 주기 점검)
 *
 * 현재 상태:
 *   onSignalBuy         — 인터페이스 스텁 (시그널 엔진 붙일 때 실호출)
 *   onTradeExecuted     — 인터페이스 + 실동작 (poller에서 호출 가능)
 *   onPositionClosed    — 인터페이스 + 실동작
 *   demoteStaleSTier    — cron에서 주기 호출 (임시 S / 청산 후 S 자동 강등)
 */

import { addToUniverse, removeFromUniverse } from "@/lib/db/universe";
import { sql } from "@/lib/db/pool";

const SIGNAL_S_WINDOW_MIN = 60;
const CLOSED_S_COOLDOWN_HOURS = 24;

/**
 * 시그널 엔진에서 buy signal이 생성됐을 때 호출.
 * S 티어로 임시 승격 (최대 1시간). cron의 demoteStaleSTier가 초과 시 A로 강등.
 */
export async function onSignalBuy(params: {
  code: string;
  signalId?: string;
  at?: Date;
}): Promise<void> {
  const { code, signalId, at = new Date() } = params;

  await addToUniverse({
    code,
    tier: "S",
    source: "auto:signal",
    note: `signal_id=${signalId ?? "-"} at=${at.toISOString()} window=${SIGNAL_S_WINDOW_MIN}min`,
    changedBy: "hook:onSignalBuy",
  });
}

/**
 * 매수 체결 감지 시 호출. S 티어로 고정 (포지션 청산 전까지).
 * 이미 S면 note 업데이트로 타임스탬프 갱신 (간접: 새 이력만 기록).
 */
export async function onTradeExecuted(params: {
  code: string;
  tradeId: string;
  executedAt: Date;
}): Promise<void> {
  const { code, tradeId, executedAt } = params;

  await addToUniverse({
    code,
    tier: "S",
    source: "auto:trade",
    note: `trade_id=${tradeId} executed_at=${executedAt.toISOString()}`,
    changedBy: "hook:onTradeExecuted",
  });

  await sql`
    INSERT INTO universe_history (code, old_tier, new_tier, reason, changed_by)
    VALUES (${code}, 'S', 'S', 'trade_executed_marker', 'hook:onTradeExecuted')
  `;
}

/**
 * 포지션 청산 시 호출. S 유지하되 24h 후 A로 강등되도록 마커 기록.
 */
export async function onPositionClosed(params: {
  code: string;
  closedAt: Date;
  reason?: string;
}): Promise<void> {
  const { code, closedAt, reason } = params;

  await sql`
    INSERT INTO universe_history (code, old_tier, new_tier, reason, changed_by)
    VALUES (
      ${code}, 'S', 'S', 'position_closed_marker',
      ${"hook:onPositionClosed " + (reason ?? "")}
    )
  `;
  // closedAt은 이력의 changed_at으로 포괄. 현재 스키마 상 closed_at 별도 저장 없음 —
  // 필요 시 symbols 테이블에 last_closed_at 컬럼 추가 고려.
  void closedAt;
}

/**
 * 주기 호출 (cron). 두 가지 경우 S 자동 강등:
 *   1. 시그널로 임시 S 됐는데 1시간 내 체결 마커 없으면 → A
 *   2. 포지션 청산 후 24h 경과하면 → A
 *
 * @returns 강등된 code 배열
 */
export async function demoteStaleSTier(now: Date = new Date()): Promise<string[]> {
  const windowStart = new Date(now.getTime() - SIGNAL_S_WINDOW_MIN * 60 * 1000);
  const cooldownStart = new Date(now.getTime() - CLOSED_S_COOLDOWN_HOURS * 60 * 60 * 1000);

  // 1) 시그널 임시 S 만료 — auto:signal로 S 승격됐고, 이후 trade_executed_marker가 없는 경우
  type Row = { code: string };
  const signalStaleRows = await sql<Row[]>`
    WITH latest_s AS (
      SELECT DISTINCT ON (u.code)
        u.code, u.source, u.included_on,
        (
          SELECT MAX(h.changed_at)
          FROM universe_history h
          WHERE h.code = u.code
            AND h.reason = 'trade_executed_marker'
        ) AS last_trade_marker
      FROM universe u
      WHERE u.tier = 'S' AND u.excluded_on IS NULL
    )
    SELECT code FROM latest_s
    WHERE source = 'auto:signal'
      AND included_on < ${windowStart.toISOString().slice(0, 10)}::date
      AND (last_trade_marker IS NULL OR last_trade_marker < ${windowStart.toISOString()})
  `;

  // 2) 청산 후 cooldown 경과 — position_closed_marker가 cooldownStart보다 이전
  const closedStaleRows = await sql<Row[]>`
    WITH closed_markers AS (
      SELECT code, MAX(changed_at) AS last_closed
      FROM universe_history
      WHERE reason = 'position_closed_marker'
      GROUP BY code
    ),
    reopened AS (
      SELECT code, MAX(changed_at) AS last_exec
      FROM universe_history
      WHERE reason = 'trade_executed_marker'
      GROUP BY code
    )
    SELECT u.code
    FROM universe u
    JOIN closed_markers cm ON cm.code = u.code
    LEFT JOIN reopened r ON r.code = u.code
    WHERE u.tier = 'S'
      AND u.excluded_on IS NULL
      AND cm.last_closed < ${cooldownStart.toISOString()}
      AND (r.last_exec IS NULL OR r.last_exec < cm.last_closed)
  `;

  const demotedCodes = new Set<string>();
  for (const r of signalStaleRows) demotedCodes.add(r.code);
  for (const r of closedStaleRows) demotedCodes.add(r.code);

  for (const code of demotedCodes) {
    await addToUniverse({
      code,
      tier: "A",
      source: "auto:demote",
      note: `demoted from S at ${now.toISOString()}`,
      changedBy: "cron:demoteStaleSTier",
    });
  }

  return Array.from(demotedCodes);
}
