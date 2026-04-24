/**
 * GET /api/symbols/list?tier=A&sector=반도체&limit=500
 *
 * 유니버스 편입 종목 리스트 + 섹터/티어별 집계.
 *
 * 필터:
 *   tier: 'S'|'A'|'B'|'ALL' (default 'ALL')
 *   sector: 부분 일치 (name sector ILIKE %sector%)
 *   limit: 1..2000 (default 500)
 *
 * 응답:
 *   {
 *     symbols: [{ code, name, market, sector, tier }],
 *     byTier: { S: N, A: N, B: N },
 *     bySector: { "섹터명": N, ... },
 *     total: N
 *   }
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
  tier: "S" | "A" | "B";
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tierParam = (url.searchParams.get("tier") ?? "ALL").toUpperCase();
  const sectorParam = (url.searchParams.get("sector") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 500);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 1), 2000);

  const tierFilter: string[] =
    tierParam === "S" ? ["S"] :
    tierParam === "A" ? ["A"] :
    tierParam === "B" ? ["B"] :
    ["S", "A", "B"];

  const sectorPattern = sectorParam ? `%${sectorParam}%` : null;

  const rows = await sql<Row[]>`
    SELECT
      s.code,
      s.name,
      s.market,
      s.sector,
      u.tier
    FROM universe u
    JOIN symbols s ON s.code = u.code
    WHERE u.excluded_on IS NULL
      AND u.tier = ANY(${tierFilter})
      AND s.trading_status = 'ACTIVE'
      ${sectorPattern ? sql`AND s.sector ILIKE ${sectorPattern}` : sql``}
    ORDER BY
      CASE u.tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 END,
      s.sector NULLS LAST,
      s.code
    LIMIT ${limit}
  `;

  const byTier: Record<string, number> = { S: 0, A: 0, B: 0 };
  const bySector: Record<string, number> = {};
  for (const r of rows) {
    byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    const sec = r.sector ?? "(미분류)";
    bySector[sec] = (bySector[sec] ?? 0) + 1;
  }

  return NextResponse.json({
    symbols: rows,
    byTier,
    bySector,
    total: rows.length,
  });
}
