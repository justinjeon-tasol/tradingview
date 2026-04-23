import { sql } from "./pool";

export type Market = "KOSPI" | "KOSDAQ";
export type Tier = "S" | "A" | "B";
export type TradingStatus = "ACTIVE" | "HALTED" | "DELISTED";

export type SymbolRecord = {
  code: string;
  name: string;
  market: Market;
  sector: string | null;
  tags: string[];
  is_etf: boolean;
  tradable: boolean;
  trading_status: TradingStatus;
  listed_on: string | null;
  delisted_on: string | null;
  market_cap: number | null;
  avg_daily_value: number | null;
};

export type UniverseRow = {
  code: string;
  tier: Tier;
  included_on: string;
  excluded_on: string | null;
  source: string;
  note: string | null;
};

export async function upsertSymbol(s: {
  code: string;
  name: string;
  market: Market;
  sector?: string | null;
  tags?: string[];
  is_etf?: boolean;
  tradable?: boolean;
  listed_on?: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO symbols (code, name, market, sector, tags, is_etf, tradable, listed_on)
    VALUES (
      ${s.code},
      ${s.name},
      ${s.market},
      ${s.sector ?? null},
      ${s.tags ?? []},
      ${s.is_etf ?? false},
      ${s.tradable ?? true},
      ${s.listed_on ?? null}
    )
    ON CONFLICT (code) DO UPDATE SET
      name            = EXCLUDED.name,
      market          = EXCLUDED.market,
      sector          = EXCLUDED.sector,
      tags            = EXCLUDED.tags,
      is_etf          = EXCLUDED.is_etf,
      tradable        = EXCLUDED.tradable,
      listed_on       = COALESCE(EXCLUDED.listed_on, symbols.listed_on),
      last_updated_at = now()
  `;
}

export async function addToUniverse(params: {
  code: string;
  tier: Tier;
  source: string;
  note?: string;
  changedBy?: string;
}): Promise<{ changed: boolean; oldTier: Tier | null }> {
  const { code, tier, source, note, changedBy = "system" } = params;

  const existingRows = await sql<UniverseRow[]>`
    SELECT code, tier, included_on, excluded_on, source, note
    FROM universe
    WHERE code = ${code} AND excluded_on IS NULL
  `;
  const existing = existingRows[0] ?? null;

  if (existing && existing.tier === tier) {
    return { changed: false, oldTier: existing.tier };
  }

  await sql.begin(async (tx) => {
    if (existing) {
      await tx`
        UPDATE universe SET excluded_on = current_date
        WHERE code = ${code} AND tier = ${existing.tier} AND included_on = ${existing.included_on}
      `;
    }
    await tx`
      INSERT INTO universe (code, tier, included_on, source, note)
      VALUES (${code}, ${tier}, current_date, ${source}, ${note ?? null})
      ON CONFLICT (code, tier, included_on) DO NOTHING
    `;
    await tx`
      INSERT INTO universe_history (code, old_tier, new_tier, reason, changed_by)
      VALUES (${code}, ${existing?.tier ?? null}, ${tier}, ${source}, ${changedBy})
    `;
  });

  return { changed: true, oldTier: existing?.tier ?? null };
}

export async function removeFromUniverse(params: {
  code: string;
  reason: string;
  changedBy?: string;
}): Promise<boolean> {
  const { code, reason, changedBy = "system" } = params;

  const existingRows = await sql<UniverseRow[]>`
    SELECT code, tier, included_on
    FROM universe
    WHERE code = ${code} AND excluded_on IS NULL
  `;
  const existing = existingRows[0];
  if (!existing) return false;

  await sql.begin(async (tx) => {
    await tx`
      UPDATE universe SET excluded_on = current_date
      WHERE code = ${code} AND tier = ${existing.tier} AND included_on = ${existing.included_on}
    `;
    await tx`
      INSERT INTO universe_history (code, old_tier, new_tier, reason, changed_by)
      VALUES (${code}, ${existing.tier}, 'OUT', ${reason}, ${changedBy})
    `;
  });
  return true;
}

export async function activeUniverse(tier?: Tier): Promise<UniverseRow[]> {
  if (tier) {
    return sql<UniverseRow[]>`
      SELECT code, tier, included_on, excluded_on, source, note
      FROM universe
      WHERE tier = ${tier} AND excluded_on IS NULL
      ORDER BY code
    `;
  }
  return sql<UniverseRow[]>`
    SELECT code, tier, included_on, excluded_on, source, note
    FROM universe
    WHERE excluded_on IS NULL
    ORDER BY tier, code
  `;
}

export async function symbolByCode(code: string): Promise<SymbolRecord | null> {
  const rows = await sql<SymbolRecord[]>`
    SELECT code, name, market, sector, tags, is_etf, tradable,
           trading_status, listed_on::text, delisted_on::text,
           market_cap::bigint, avg_daily_value::bigint
    FROM symbols
    WHERE code = ${code}
  `;
  return rows[0] ?? null;
}
