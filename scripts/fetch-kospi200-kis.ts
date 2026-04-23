/**
 * scripts/fetch-kospi200-kis.ts
 *
 * KIS의 ETF 구성종목 API(FHKST121600C0)를 이용해 KOSPI 200(≈ KODEX 200)
 * 구성종목을 조회 → universe-load 호환 JSON으로 저장.
 *
 * pykrx 경로 대비 장점:
 *   - 기존 KIS 토큰 인프라 재활용 (별도 KRX 계정 불필요)
 *   - 가격·등락률 데이터 동시 확보 → 추후 시총 필터링에 활용 가능
 *
 * 사용:
 *   npm run universe:fetch:kospi200          # KODEX 200 → data/seed/kospi200.json
 *   npm run universe:fetch:kospi200 -- --etf 102110   # TIGER 200 사용
 *
 * 참고: KODEX 200(069500)은 KOSPI 200 공식 지수 구성을 99%+ 복제.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { fetchEtfComponents } from "@/lib/kis/etf";

const ETF_ALIASES: Record<string, { code: string; label: string; market: "KOSPI" | "KOSDAQ"; trackedIndex: string }> = {
  kodex200: { code: "069500", label: "KODEX 200", market: "KOSPI", trackedIndex: "KOSPI 200" },
  tiger200: { code: "102110", label: "TIGER 200", market: "KOSPI", trackedIndex: "KOSPI 200" },
  kodex_kq150: { code: "229200", label: "KODEX 코스닥150", market: "KOSDAQ", trackedIndex: "KOSDAQ 150" },
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const alias = (args.alias ?? "kodex200").trim();
  const presetKey = alias in ETF_ALIASES ? alias : null;
  const preset = presetKey ? ETF_ALIASES[presetKey]! : null;
  const etfCode = (args.etf ?? preset?.code ?? "069500").trim();
  const market = preset?.market ?? ((args.market as "KOSPI" | "KOSDAQ") || "KOSPI");
  const label = preset?.label ?? `ETF ${etfCode}`;
  const trackedIndex = preset?.trackedIndex ?? "";

  if (!/^\d{6}$/.test(etfCode)) {
    console.error(`[fetch-kospi200-kis] invalid ETF code: ${etfCode}`);
    process.exit(1);
  }

  console.log(`[fetch-kospi200-kis] ${label} (${etfCode}) 구성종목 조회`);
  const components = await fetchEtfComponents(etfCode);
  console.log(`[fetch-kospi200-kis] ${components.length} 종목`);

  const stocks = components.map((c) => ({
    code: c.code,
    name: c.name,
    market,
    sector: null,
    tags: [] as string[],
  }));

  const payload = {
    meta: {
      source: "kis:FHKST121600C0",
      etf_code: etfCode,
      etf_label: label,
      tracked_index: trackedIndex,
      market,
      fetched_at: new Date().toISOString(),
      count: stocks.length,
    },
    stocks,
  };

  const defaultFilename =
    presetKey === "kodex_kq150" ? "kosdaq150.json" : "kospi200.json";
  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(process.cwd(), "data", "seed", defaultFilename);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[fetch-kospi200-kis] wrote ${stocks.length} stocks → ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
