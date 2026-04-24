/**
 * GET /api/symbols/search?q=<query>&limit=10
 *
 * 종목 자동완성 검색. 쿼리 해석:
 *   - 6자리 숫자: code 정확 매칭 + 나머지 prefix
 *   - 그 외 (한글/영문/부분숫자): name ILIKE %q% + code prefix
 *
 * 정렬 우선순위 (동률 내부는 code asc):
 *   1. 정확한 code 일치
 *   2. code prefix 일치
 *   3. name prefix 일치 (정확 일치 포함)
 *   4. name contains
 *
 * 응답:
 *   { symbols: [{ code, name, market, sector, tier, inUniverse }] }
 *   tier: 'S'|'A'|'B'|null (universe에 없으면 null)
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  sector: string | null;
  tier: "S" | "A" | "B" | null;
  rank: number;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 10, 1), 50);

  if (!q) {
    return NextResponse.json({ symbols: [] });
  }

  const pattern = `%${q}%`;
  const prefix = `${q}%`;

  const rows = await sql<Row[]>`
    SELECT
      s.code,
      s.name,
      s.market,
      s.sector,
      u.tier,
      CASE
        WHEN s.code = ${q} THEN 1
        WHEN s.code LIKE ${prefix} THEN 2
        WHEN s.name ILIKE ${prefix} THEN 3
        ELSE 4
      END AS rank
    FROM symbols s
    LEFT JOIN LATERAL (
      SELECT tier FROM universe
      WHERE code = s.code AND excluded_on IS NULL
      ORDER BY
        CASE tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 END
      LIMIT 1
    ) u ON TRUE
    WHERE
      s.trading_status = 'ACTIVE'
      AND (
        s.code LIKE ${prefix}
        OR s.name ILIKE ${pattern}
      )
    ORDER BY rank, s.code
    LIMIT ${limit}
  `;

  return NextResponse.json({
    symbols: rows.map((r) => ({
      code: r.code,
      name: r.name,
      market: r.market,
      sector: r.sector,
      tier: r.tier,
      inUniverse: r.tier !== null,
    })),
  });
}
