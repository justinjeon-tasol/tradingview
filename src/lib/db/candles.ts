import type { UTCTimestamp } from "lightweight-charts";
import { sql } from "./pool";
import type { Bar, DailyBar } from "@/lib/kis/candles";

type Row = {
  time_utc: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: bigint;
};

function rowToBar(row: Row): Bar {
  return {
    time: Math.floor(row.time_utc.getTime() / 1000) as UTCTimestamp,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

export async function selectBars(
  symbol: string,
  opts: { fromUtc?: Date; toUtc?: Date; limit?: number } = {},
): Promise<Bar[]> {
  const from = opts.fromUtc ?? new Date(0);
  const to = opts.toUtc ?? new Date("2999-12-31");
  const limit = opts.limit ?? 5000;

  const rows = await sql<Row[]>`
    SELECT time_utc, open, high, low, close, volume
    FROM candles_1m
    WHERE symbol = ${symbol}
      AND time_utc >= ${from}
      AND time_utc <= ${to}
    ORDER BY time_utc ASC
    LIMIT ${limit}
  `;

  return rows.map(rowToBar);
}

export async function earliestBarTime(symbol: string): Promise<Date | null> {
  const rows = await sql<{ time_utc: Date | null }[]>`
    SELECT MIN(time_utc) AS time_utc
    FROM candles_1m
    WHERE symbol = ${symbol}
  `;
  return rows[0]?.time_utc ?? null;
}

export async function latestBarTime(symbol: string): Promise<Date | null> {
  const rows = await sql<{ time_utc: Date | null }[]>`
    SELECT MAX(time_utc) AS time_utc
    FROM candles_1m
    WHERE symbol = ${symbol}
  `;
  return rows[0]?.time_utc ?? null;
}

export async function upsertBars(
  symbol: string,
  bars: Bar[],
): Promise<number> {
  if (bars.length === 0) return 0;

  const rows = bars.map((b) => ({
    symbol,
    time_utc: new Date(b.time * 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));

  const inserted = await sql`
    INSERT INTO candles_1m
      ${sql(rows, "symbol", "time_utc", "open", "high", "low", "close", "volume")}
    ON CONFLICT (symbol, time_utc) DO UPDATE SET
      open       = EXCLUDED.open,
      high       = EXCLUDED.high,
      low        = EXCLUDED.low,
      close      = EXCLUDED.close,
      volume     = EXCLUDED.volume,
      fetched_at = now()
  `;

  return inserted.count ?? 0;
}

export async function logFetch(entry: {
  symbol: string;
  interval: string;
  fromUtc: Date;
  toUtc: Date;
  barCount: number;
}): Promise<void> {
  await sql`
    INSERT INTO candles_fetch_log (symbol, interval, from_utc, to_utc, bar_count)
    VALUES (${entry.symbol}, ${entry.interval}, ${entry.fromUtc}, ${entry.toUtc}, ${entry.barCount})
  `;
}

type DailyRow = {
  trade_date: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: bigint;
};

function dailyRowToBar(row: DailyRow): DailyBar {
  const d = row.trade_date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return {
    tradeDate: `${y}-${m}-${day}`,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

export async function selectDailyBars(
  symbol: string,
  opts: { fromDate?: string; toDate?: string; limit?: number } = {},
): Promise<DailyBar[]> {
  const from = opts.fromDate ?? "1900-01-01";
  const to = opts.toDate ?? "2999-12-31";
  const limit = opts.limit ?? 5000;

  const rows = await sql<DailyRow[]>`
    SELECT trade_date, open, high, low, close, volume
    FROM candles_daily
    WHERE symbol = ${symbol}
      AND period = 'D'
      AND trade_date >= ${from}::date
      AND trade_date <= ${to}::date
    ORDER BY trade_date ASC
    LIMIT ${limit}
  `;
  return rows.map(dailyRowToBar);
}

export async function upsertDailyBars(
  symbol: string,
  bars: DailyBar[],
): Promise<number> {
  if (bars.length === 0) return 0;

  const rows = bars.map((b) => ({
    symbol,
    period: "D",
    trade_date: b.tradeDate,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));

  const inserted = await sql`
    INSERT INTO candles_daily
      ${sql(rows, "symbol", "period", "trade_date", "open", "high", "low", "close", "volume")}
    ON CONFLICT (symbol, period, trade_date) DO UPDATE SET
      open       = EXCLUDED.open,
      high       = EXCLUDED.high,
      low        = EXCLUDED.low,
      close      = EXCLUDED.close,
      volume     = EXCLUDED.volume,
      fetched_at = now()
  `;
  return inserted.count ?? 0;
}

export async function earliestDailyDate(symbol: string): Promise<string | null> {
  const rows = await sql<{ trade_date: Date | null }[]>`
    SELECT MIN(trade_date) AS trade_date
    FROM candles_daily
    WHERE symbol = ${symbol} AND period = 'D'
  `;
  const d = rows[0]?.trade_date;
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function latestDailyDate(symbol: string): Promise<string | null> {
  const rows = await sql<{ trade_date: Date | null }[]>`
    SELECT MAX(trade_date) AS trade_date
    FROM candles_daily
    WHERE symbol = ${symbol} AND period = 'D'
  `;
  const d = rows[0]?.trade_date;
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
