/**
 * POST /api/cron/flows-daily
 *
 * 외부 cron (VM1 crontab 또는 다른 스케줄러)에서 호출.
 * Authorization: Bearer $CRON_SHARED_SECRET 필수.
 *
 * 쿼리:
 *   ?date=YYYYMMDD   (생략 시 오늘 KST)
 *   ?dry=1           (DB 기록 없이 fetch만)
 *
 * 동작:
 *   universe(S/A/B, ACTIVE, non-ETF) 전체를 순회하며 FHPTJ04160001 수집.
 *   각 종목 사이 150ms 간격. flows_daily_log에 triggered_by='cron' 기록.
 *
 * 응답: { date, coverage, expected, failed_count, duration_ms }
 *
 * 예시 cron (VM1):
 *   30 16 * * 1-5 curl -s -X POST -H "Authorization: Bearer $CRON_SHARED_SECRET" \
 *     http://100.84.139.36:3000/api/cron/flows-daily >> /var/log/tv1-cron.log 2>&1
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db/pool";
import {
  fetchInvestorFlowsDaily,
  type FlowRecord,
} from "@/lib/kis/investor-flows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const DELAY_MS = 150;

function todayYYYYMMDD(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function upsertRecord(rec: FlowRecord): Promise<void> {
  await sql`
    INSERT INTO flows_daily (
      date, code,
      foreign_net_qty, foreign_net_value,
      institution_net_qty, institution_net_value,
      individual_net_qty, individual_net_value,
      foreign_reg_net_qty, foreign_reg_net_value,
      foreign_nreg_net_qty, foreign_nreg_net_value,
      inst_securities_net_value, inst_trust_net_value,
      inst_privfund_net_value, inst_bank_net_value,
      inst_insurance_net_value, inst_merbank_net_value,
      inst_pension_net_value, inst_other_net_value,
      etc_corp_net_value,
      close_price, volume, value
    )
    VALUES (
      ${rec.date}, ${rec.code},
      ${rec.foreign_net_qty}, ${rec.foreign_net_value},
      ${rec.institution_net_qty}, ${rec.institution_net_value},
      ${rec.individual_net_qty}, ${rec.individual_net_value},
      ${rec.foreign_reg_net_qty}, ${rec.foreign_reg_net_value},
      ${rec.foreign_nreg_net_qty}, ${rec.foreign_nreg_net_value},
      ${rec.inst_securities_net_value}, ${rec.inst_trust_net_value},
      ${rec.inst_privfund_net_value}, ${rec.inst_bank_net_value},
      ${rec.inst_insurance_net_value}, ${rec.inst_merbank_net_value},
      ${rec.inst_pension_net_value}, ${rec.inst_other_net_value},
      ${rec.etc_corp_net_value},
      ${rec.close_price}, ${rec.volume}, ${rec.value}
    )
    ON CONFLICT (date, code) DO UPDATE SET
      foreign_net_qty          = EXCLUDED.foreign_net_qty,
      foreign_net_value        = EXCLUDED.foreign_net_value,
      institution_net_qty      = EXCLUDED.institution_net_qty,
      institution_net_value    = EXCLUDED.institution_net_value,
      individual_net_qty       = EXCLUDED.individual_net_qty,
      individual_net_value     = EXCLUDED.individual_net_value,
      foreign_reg_net_qty      = EXCLUDED.foreign_reg_net_qty,
      foreign_reg_net_value    = EXCLUDED.foreign_reg_net_value,
      foreign_nreg_net_qty     = EXCLUDED.foreign_nreg_net_qty,
      foreign_nreg_net_value   = EXCLUDED.foreign_nreg_net_value,
      inst_securities_net_value = EXCLUDED.inst_securities_net_value,
      inst_trust_net_value     = EXCLUDED.inst_trust_net_value,
      inst_privfund_net_value  = EXCLUDED.inst_privfund_net_value,
      inst_bank_net_value      = EXCLUDED.inst_bank_net_value,
      inst_insurance_net_value = EXCLUDED.inst_insurance_net_value,
      inst_merbank_net_value   = EXCLUDED.inst_merbank_net_value,
      inst_pension_net_value   = EXCLUDED.inst_pension_net_value,
      inst_other_net_value     = EXCLUDED.inst_other_net_value,
      etc_corp_net_value       = EXCLUDED.etc_corp_net_value,
      close_price              = EXCLUDED.close_price,
      volume                   = EXCLUDED.volume,
      value                    = EXCLUDED.value,
      fetched_at               = now()
  `;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const targetDate = url.searchParams.get("date") ?? todayYYYYMMDD();
  const dryRun = url.searchParams.get("dry") === "1";

  if (!/^\d{8}$/.test(targetDate)) {
    return NextResponse.json(
      { error: `Invalid date "${targetDate}", expected YYYYMMDD.` },
      { status: 400 },
    );
  }

  const universe = await sql<{ code: string }[]>`
    SELECT DISTINCT u.code
    FROM universe u
    JOIN symbols s ON s.code = u.code
    WHERE u.excluded_on IS NULL
      AND u.tier IN ('S', 'A', 'B')
      AND s.trading_status = 'ACTIVE'
      AND s.is_etf = false
    ORDER BY u.code
  `;

  const started = Date.now();
  const failed: string[] = [];
  let coverage = 0;

  for (const row of universe) {
    const code = row.code;
    try {
      const { records } = await fetchInvestorFlowsDaily({ code, date: targetDate });
      const match = records.find(
        (r) => r.date.replace(/-/g, "") === targetDate,
      );
      if (!match) {
        failed.push(code);
        continue;
      }
      if (!dryRun) await upsertRecord(match);
      coverage++;
    } catch {
      failed.push(code);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const durationMs = Date.now() - started;
  const dateIso = `${targetDate.slice(0, 4)}-${targetDate.slice(4, 6)}-${targetDate.slice(6, 8)}`;

  if (!dryRun) {
    await sql`
      INSERT INTO flows_daily_log (
        date, coverage, expected, failed_codes, duration_ms, triggered_by
      )
      VALUES (
        ${dateIso}, ${coverage}, ${universe.length}, ${failed},
        ${durationMs}, 'cron'
      )
    `;
  }

  return NextResponse.json({
    date: dateIso,
    coverage,
    expected: universe.length,
    failed_count: failed.length,
    duration_ms: durationMs,
    dry_run: dryRun,
  });
}
