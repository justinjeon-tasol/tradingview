/**
 * scripts/trades-poll.ts
 *
 * Supabase trades/positions 테이블 폴링 → universe 훅 호출.
 *
 * 감지 규칙:
 *   trades.action = 'BUY' AND signal_source != 'KIS_SYNC'
 *     → onTradeExecuted(code)  → S 티어 승격
 *   positions.status = 'CLOSED' AND closed_at > cursor
 *     → onPositionClosed(code)  → 24h 후 A 강등 예약 (cron demoteStaleSTier)
 *
 * 커서는 TimescaleDB poll_cursors 테이블에 저장 (다중 인스턴스·재시작 안전).
 *
 * 사용:
 *   npm run trades:poll                             # 연속 폴링 (기본 30초)
 *   npm run trades:poll -- --once                   # 한 번만 실행하고 종료
 *   npm run trades:poll -- --dry-run                # 훅 호출 X, 로그만
 *   npm run trades:poll -- --since 2026-04-23T00:00:00Z   # 해당 시각부터 재시작
 *   npm run trades:poll -- --interval 60            # 60초 주기
 *
 * 전제:
 *   - .env.local에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 설정
 *   - Supabase trades, positions 테이블이 anon 키로 SELECT 가능 (RLS 허용 상태)
 *   - VM1 TimescaleDB에 poll_cursors 테이블 생성됨 (003_poll_cursors.sql)
 */

import { sql } from "@/lib/db/pool";
import { onPositionClosed, onTradeExecuted } from "@/lib/universe/hooks";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CURSOR_KEY_BUYS = "supabase:trades:buy";
const CURSOR_KEY_CLOSED = "supabase:positions:closed";

const DEFAULT_INTERVAL_SEC = 30;
const INITIAL_CURSOR_OFFSET_SEC = 60;

type SupabaseTrade = {
  id: string;
  code: string;
  created_at: string;
  action: "BUY" | "SELL";
  mode: string;
  signal_source: string | null;
};

type SupabasePosition = {
  code: string;
  closed_at: string;
  close_reason: string | null;
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function getCursor(key: string, fallback: Date): Promise<Date> {
  const rows = await sql<{ last_seen: Date }[]>`
    SELECT last_seen FROM poll_cursors WHERE key = ${key}
  `;
  if (rows[0]) return rows[0].last_seen;
  await sql`
    INSERT INTO poll_cursors (key, last_seen) VALUES (${key}, ${fallback})
  `;
  return fallback;
}

async function setCursor(key: string, at: Date): Promise<void> {
  await sql`
    INSERT INTO poll_cursors (key, last_seen) VALUES (${key}, ${at})
    ON CONFLICT (key) DO UPDATE SET last_seen = EXCLUDED.last_seen, updated_at = now()
  `;
}

async function supabaseSelect<T>(
  table: string,
  queryString: string,
): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${queryString}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${table} ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T[];
}

async function pollBuys(cursor: Date, dryRun: boolean): Promise<Date> {
  const q =
    `select=id,code,created_at,action,mode,signal_source` +
    `&action=eq.BUY` +
    `&created_at=gt.${encodeURIComponent(cursor.toISOString())}` +
    `&order=created_at.asc&limit=500`;

  const rows = await supabaseSelect<SupabaseTrade>("trades", q);

  let maxAt = cursor;
  let processed = 0;
  let skippedSync = 0;

  for (const t of rows) {
    const at = new Date(t.created_at);
    if (at > maxAt) maxAt = at;

    if (t.signal_source === "KIS_SYNC") {
      skippedSync++;
      continue;
    }

    console.log(
      `[trades-poll] BUY ${t.code} id=${t.id} at=${t.created_at} mode=${t.mode}`,
    );
    processed++;

    if (!dryRun) {
      try {
        await onTradeExecuted({ code: t.code, tradeId: t.id, executedAt: at });
      } catch (err) {
        console.error(`  onTradeExecuted failed for ${t.code}:`, err);
      }
    }
  }

  if (rows.length > 0 || processed > 0) {
    console.log(
      `[trades-poll] BUY scan: rows=${rows.length} processed=${processed} skippedKisSync=${skippedSync}`,
    );
  }

  if (!dryRun) await setCursor(CURSOR_KEY_BUYS, maxAt);
  return maxAt;
}

async function pollClosed(cursor: Date, dryRun: boolean): Promise<Date> {
  const q =
    `select=code,closed_at,close_reason` +
    `&status=eq.CLOSED` +
    `&closed_at=gt.${encodeURIComponent(cursor.toISOString())}` +
    `&order=closed_at.asc&limit=500`;

  const rows = await supabaseSelect<SupabasePosition>("positions", q);

  let maxAt = cursor;
  for (const p of rows) {
    const at = new Date(p.closed_at);
    if (at > maxAt) maxAt = at;

    console.log(
      `[trades-poll] CLOSED ${p.code} at=${p.closed_at} reason=${p.close_reason ?? "-"}`,
    );

    if (!dryRun) {
      try {
        await onPositionClosed({
          code: p.code,
          closedAt: at,
          reason: p.close_reason ?? undefined,
        });
      } catch (err) {
        console.error(`  onPositionClosed failed for ${p.code}:`, err);
      }
    }
  }

  if (rows.length > 0) {
    console.log(`[trades-poll] CLOSED scan: rows=${rows.length}`);
  }

  if (!dryRun) await setCursor(CURSOR_KEY_CLOSED, maxAt);
  return maxAt;
}

async function runOnce(opts: {
  dryRun: boolean;
  buyCursor: Date;
  closedCursor: Date;
}): Promise<{ buyCursor: Date; closedCursor: Date }> {
  let { buyCursor, closedCursor } = opts;
  try {
    buyCursor = await pollBuys(buyCursor, opts.dryRun);
  } catch (err) {
    console.error(`[trades-poll] BUY poll error:`, err);
  }
  try {
    closedCursor = await pollClosed(closedCursor, opts.dryRun);
  } catch (err) {
    console.error(`[trades-poll] CLOSED poll error:`, err);
  }
  return { buyCursor, closedCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "[trades-poll] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY가 .env.local에 없습니다.",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const once = args.once === "true";
  const dryRun = args["dry-run"] === "true";
  const intervalSec = args.interval
    ? Number(args.interval)
    : DEFAULT_INTERVAL_SEC;
  const since = args.since ? new Date(args.since) : null;

  const fallbackCursor =
    since ?? new Date(Date.now() - INITIAL_CURSOR_OFFSET_SEC * 1000);
  let buyCursor = since ?? (await getCursor(CURSOR_KEY_BUYS, fallbackCursor));
  let closedCursor =
    since ?? (await getCursor(CURSOR_KEY_CLOSED, fallbackCursor));

  console.log(`[trades-poll] starting`);
  console.log(`  dryRun=${dryRun} once=${once} intervalSec=${intervalSec}`);
  console.log(`  buyCursor    = ${buyCursor.toISOString()}`);
  console.log(`  closedCursor = ${closedCursor.toISOString()}`);

  let stopping = false;
  const shutdown = () => {
    console.log("[trades-poll] shutdown signal");
    stopping = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    while (!stopping) {
      const result = await runOnce({ dryRun, buyCursor, closedCursor });
      buyCursor = result.buyCursor;
      closedCursor = result.closedCursor;

      if (once) break;

      for (let i = 0; i < intervalSec * 10 && !stopping; i++) {
        await sleep(100);
      }
    }
  } finally {
    await sql.end();
  }
  console.log("[trades-poll] stopped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
