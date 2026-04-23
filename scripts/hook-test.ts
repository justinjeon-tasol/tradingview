/**
 * scripts/hook-test.ts
 *
 * universe hooks 수동 호출 테스트.
 *
 * 사용 예:
 *   npm run hook:test -- --event signal-buy  --code 005930
 *   npm run hook:test -- --event trade       --code 005930 --trade-id TX123
 *   npm run hook:test -- --event close       --code 005930
 *   npm run hook:test -- --event demote-stale
 */

import { sql } from "@/lib/db/pool";
import {
  demoteStaleSTier,
  onPositionClosed,
  onSignalBuy,
  onTradeExecuted,
} from "@/lib/universe/hooks";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const event = args.event;

  try {
    switch (event) {
      case "signal-buy": {
        if (!args.code) throw new Error("--code 필요");
        await onSignalBuy({ code: args.code, signalId: args["signal-id"] });
        console.log(`[hook-test] signal-buy ${args.code} dispatched → S tier (임시)`);
        break;
      }
      case "trade": {
        if (!args.code) throw new Error("--code 필요");
        await onTradeExecuted({
          code: args.code,
          tradeId: args["trade-id"] ?? `manual-${Date.now()}`,
          executedAt: new Date(),
        });
        console.log(`[hook-test] trade ${args.code} dispatched → S tier (고정)`);
        break;
      }
      case "close": {
        if (!args.code) throw new Error("--code 필요");
        await onPositionClosed({
          code: args.code,
          closedAt: new Date(),
          reason: args.reason ?? "manual",
        });
        console.log(`[hook-test] close ${args.code} dispatched (S 유지, 24h 후 강등)`);
        break;
      }
      case "demote-stale": {
        const demoted = await demoteStaleSTier();
        console.log(`[hook-test] demote-stale: ${demoted.length}건 A로 강등`);
        for (const c of demoted) console.log(`  - ${c}`);
        break;
      }
      default:
        console.error(
          "--event <signal-buy | trade | close | demote-stale> 필요",
        );
        process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
