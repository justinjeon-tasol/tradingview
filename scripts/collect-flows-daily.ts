/**
 * scripts/collect-flows-daily.ts
 *
 * Universe(tier S/A/B, ACTIVE, non-ETF)에 대해 하루치 투자자매매동향(FHPTJ04160001)을 수집.
 *
 * 사용:
 *   npm run flows:collect                                 # 오늘 날짜 (장마감 후 16:30+ 실행)
 *   npm run flows:collect -- --date=20260423              # 특정일 지정 (백필)
 *   npm run flows:collect -- --dry-run --symbol=005930    # 단일 종목, DB 기록 없이 출력만
 *   npm run flows:collect -- --since=20260401 --until=20260423  # 백필 범위
 *   npm run flows:collect -- --cron                       # triggered_by=cron으로 로그 기록
 *
 * 레이트 리밋: 기본 150ms 간격 (≈6 TPS, KIS 한도 20 TPS 여유). 장애 시 --delay=300 조정.
 */

import { fetchInvestorFlowsDaily, type FlowRecord } from "@/lib/kis/investor-flows";
import { sql } from "@/lib/db/pool";

type Args = {
  date: string | null;
  since: string | null;
  until: string | null;
  symbol: string | null;
  dryRun: boolean;
  cron: boolean;
  delayMs: number;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return null;
    if (hit === `--${name}`) return "true";
    return hit.slice(`--${name}=`.length);
  };
  return {
    date: get("date"),
    since: get("since"),
    until: get("until"),
    symbol: get("symbol"),
    dryRun: get("dry-run") !== null,
    cron: get("cron") !== null,
    delayMs: Number(get("delay") ?? 150),
  };
}

function todayYYYYMMDD(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function datesBetween(fromYYYYMMDD: string, toYYYYMMDD: string): string[] {
  const from = new Date(
    `${fromYYYYMMDD.slice(0, 4)}-${fromYYYYMMDD.slice(4, 6)}-${fromYYYYMMDD.slice(6, 8)}T00:00:00Z`,
  );
  const to = new Date(
    `${toYYYYMMDD.slice(0, 4)}-${toYYYYMMDD.slice(4, 6)}-${toYYYYMMDD.slice(6, 8)}T00:00:00Z`,
  );
  const out: string[] = [];
  for (let d = from; d.getTime() <= to.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue; // weekend skip
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}${m}${dd}`);
  }
  return out;
}

async function loadUniverse(args: Args): Promise<string[]> {
  if (args.symbol) return [args.symbol];

  const rows = await sql<{ code: string }[]>`
    SELECT DISTINCT u.code
    FROM universe u
    JOIN symbols s ON s.code = u.code
    WHERE u.excluded_on IS NULL
      AND u.tier IN ('S', 'A', 'B')
      AND s.trading_status = 'ACTIVE'
      AND s.is_etf = false
    ORDER BY u.code
  `;
  return rows.map((r) => r.code);
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

async function collectForDate(
  targetDate: string,
  universe: string[],
  args: Args,
): Promise<{ success: number; failed: string[]; durationMs: number }> {
  const started = Date.now();
  const failed: string[] = [];
  let success = 0;

  for (let i = 0; i < universe.length; i++) {
    const code = universe[i]!;
    try {
      const { records } = await fetchInvestorFlowsDaily({ code, date: targetDate });
      const match = records.find((r) => r.date.replace(/-/g, "") === targetDate);

      if (!match) {
        // KIS가 해당일 데이터를 아직 제공하지 않음 (장 미마감 or 공휴일)
        failed.push(code);
        continue;
      }

      if (args.dryRun) {
        console.log(
          `  DRY ${code} ${match.date}: fgn=${match.foreign_net_value} inst=${match.institution_net_value} indv=${match.individual_net_value}`,
        );
      } else {
        await upsertRecord(match);
      }
      success++;

      if ((i + 1) % 20 === 0) {
        console.log(`  ${i + 1}/${universe.length} (success=${success})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${code}: ${msg}`);
      failed.push(code);
    }

    if (args.delayMs > 0) {
      await new Promise((r) => setTimeout(r, args.delayMs));
    }
  }

  const durationMs = Date.now() - started;

  if (!args.dryRun) {
    await sql`
      INSERT INTO flows_daily_log (date, coverage, expected, failed_codes, duration_ms, triggered_by)
      VALUES (
        ${`${targetDate.slice(0, 4)}-${targetDate.slice(4, 6)}-${targetDate.slice(6, 8)}`},
        ${success},
        ${universe.length},
        ${failed},
        ${durationMs},
        ${args.cron ? "cron" : "manual"}
      )
    `;
  }

  return { success, failed, durationMs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targetDates: string[] = [];
  if (args.since) {
    targetDates.push(...datesBetween(args.since, args.until ?? args.since));
  } else if (args.date) {
    targetDates.push(args.date);
  } else {
    targetDates.push(todayYYYYMMDD());
  }

  const universe = await loadUniverse(args);
  console.log(
    `[flows-collect] dates=[${targetDates.join(",")}] universe=${universe.length} dryRun=${args.dryRun} delay=${args.delayMs}ms`,
  );

  try {
    for (const date of targetDates) {
      console.log(`\n[flows-collect] === ${date} ===`);
      const { success, failed, durationMs } = await collectForDate(date, universe, args);
      console.log(
        `[flows-collect] ${date}: success=${success}/${universe.length} failed=${failed.length} duration=${durationMs}ms`,
      );
      if (failed.length > 0 && failed.length <= 20) {
        console.log(`  failed codes: ${failed.join(", ")}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
