/**
 * scripts/universe-tier.ts
 *
 * 종목의 티어를 변경 (승격/강등/신규편입).
 *
 * 사용 예:
 *   npm run universe:tier -- --code 005930 --tier S --reason manual
 *   npm run universe:tier -- --code 005930 --tier A --reason weekly_rebalance
 *   npm run universe:tier -- --code 005930 --remove --reason delist
 *   npm run universe:tier -- --list                     # 현재 전체 티어 요약
 *   npm run universe:tier -- --list --tier A            # A 티어만
 *
 * 검증:
 *   - ETF는 A 승격 불가 (tradable=false)
 *   - market_cap < 500억은 A 승격 불가
 *   - 상장 180일 미만은 A 승격 불가
 *   - (S 티어는 제약 완화 — 시그널/매매 기준)
 */

import {
  activeUniverse,
  addToUniverse,
  removeFromUniverse,
  symbolByCode,
  type Tier,
} from "@/lib/db/universe";
import { sql } from "@/lib/db/pool";

const MIN_MARKET_CAP_FOR_A = 500n * 100_000_000n; // 500억
const MIN_LISTED_DAYS_FOR_A = 180;

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

async function validatePromotionToA(code: string): Promise<string | null> {
  const sym = await symbolByCode(code);
  if (!sym) return `unknown code ${code}`;
  if (sym.trading_status !== "ACTIVE") return `status=${sym.trading_status}`;
  if (!sym.tradable) return "tradable=false (ETF or excluded)";

  if (sym.market_cap !== null) {
    if (BigInt(sym.market_cap) < MIN_MARKET_CAP_FOR_A) {
      return `market_cap ${sym.market_cap} < 500억`;
    }
  }

  if (sym.listed_on) {
    const listed = new Date(sym.listed_on + "T00:00:00Z").getTime();
    const days = (Date.now() - listed) / (24 * 60 * 60 * 1000);
    if (days < MIN_LISTED_DAYS_FOR_A) {
      return `listed_on=${sym.listed_on} (${Math.floor(days)}일, <180)`;
    }
  }
  return null;
}

async function listCommand(tier?: Tier) {
  const rows = await activeUniverse(tier);
  const counts: Record<string, number> = { S: 0, A: 0, B: 0 };
  for (const r of rows) counts[r.tier] = (counts[r.tier] ?? 0) + 1;

  console.log(`총 ${rows.length}종목 현재 편입 중`);
  console.log(`  S=${counts.S}  A=${counts.A}  B=${counts.B}`);

  if (tier) {
    console.log(`\n== tier ${tier} ==`);
    for (const r of rows) {
      console.log(
        `  ${r.code}  included_on=${r.included_on}  source=${r.source}`,
      );
    }
  }
}

async function tierCommand(
  code: string,
  tier: Tier,
  reason: string,
  force: boolean,
) {
  if (tier === "A" && !force) {
    const err = await validatePromotionToA(code);
    if (err) {
      console.error(`[universe-tier] A 승격 거부: ${err}`);
      console.error(`  --force 로 무시 가능`);
      process.exit(2);
    }
  }

  const result = await addToUniverse({
    code,
    tier,
    source: reason,
    changedBy: "cli:universe-tier",
  });
  if (result.changed) {
    console.log(`[universe-tier] ${code}: ${result.oldTier ?? "(신규)"} → ${tier} (reason=${reason})`);
  } else {
    console.log(`[universe-tier] ${code}: 이미 ${tier} 티어. 변경 없음.`);
  }
}

async function removeCommand(code: string, reason: string) {
  const ok = await removeFromUniverse({
    code,
    reason,
    changedBy: "cli:universe-tier",
  });
  if (ok) {
    console.log(`[universe-tier] ${code}: 유니버스에서 제외 (reason=${reason})`);
  } else {
    console.log(`[universe-tier] ${code}: 편입 상태 아님. 변경 없음.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.list) {
      const t = (args.tier as Tier | undefined) || undefined;
      await listCommand(t);
      return;
    }

    const code = args.code;
    if (!code || !/^\d{6}$/.test(code)) {
      console.error("--code <6자리숫자> 필요");
      process.exit(1);
    }

    if (args.remove) {
      const reason = args.reason ?? "manual";
      await removeCommand(code, reason);
      return;
    }

    const tier = args.tier as Tier | undefined;
    if (!tier || !["S", "A", "B"].includes(tier)) {
      console.error("--tier S|A|B 필요 (또는 --remove)");
      process.exit(1);
    }
    const reason = args.reason ?? "manual";
    const force = args.force === "true";
    await tierCommand(code, tier, reason, force);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
