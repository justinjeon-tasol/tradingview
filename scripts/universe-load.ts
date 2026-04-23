/**
 * scripts/universe-load.ts
 *
 * 시드 JSON 파일을 읽어 symbols + universe(B 티어) 편입.
 *
 * 사용:
 *   npm run universe:load
 *   npm run universe:load -- --file data/seed/universe_expanded.json --tier B --source manual
 *
 * 기본:
 *   file = data/seed/universe_expanded.json
 *   tier = B
 *   source = 'manual'
 *
 * 동작:
 *   - 각 항목을 symbols에 upsert (name/market/sector/tags/is_etf 반영)
 *   - 아직 universe에 없거나 다른 티어면 addToUniverse(tier) 호출
 *   - universe_history에 reason='initial_seed' 로 이력 기록
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { addToUniverse, upsertSymbol } from "@/lib/db/universe";
import { sql } from "@/lib/db/pool";

type SeedStock = {
  code: string;
  name: string;
  sector?: string;
  market: "KOSPI" | "KOSDAQ";
  tags?: string[];
  is_etf?: boolean;
};

type Seed = { stocks: SeedStock[] };

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
  const file = args.file ?? "data/seed/universe_expanded.json";
  const tier = (args.tier ?? "B") as "S" | "A" | "B";
  const source = args.source ?? "manual";

  const resolved = path.resolve(process.cwd(), file);
  console.log(`[universe-load] reading ${resolved}`);
  const seed = JSON.parse(readFileSync(resolved, "utf-8")) as Seed;
  console.log(`[universe-load] ${seed.stocks.length} stocks in seed`);

  let upserted = 0;
  let addedToUniverse = 0;
  let skipped = 0;

  for (const s of seed.stocks) {
    try {
      await upsertSymbol({
        code: s.code,
        name: s.name,
        market: s.market,
        sector: s.sector ?? null,
        tags: s.tags ?? [],
        is_etf: s.is_etf ?? false,
        tradable: !(s.is_etf ?? false),
      });
      upserted++;

      const { changed } = await addToUniverse({
        code: s.code,
        tier,
        source,
        note: `seeded from ${path.basename(file)}`,
        changedBy: "cli:universe-load",
      });
      if (changed) addedToUniverse++;
      else skipped++;
    } catch (err) {
      console.error(`[universe-load] FAILED ${s.code} ${s.name}:`, err);
    }
  }

  console.log(
    `[universe-load] done — symbols upserted=${upserted}, universe changed=${addedToUniverse}, unchanged=${skipped}`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
