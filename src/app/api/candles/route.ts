import { NextResponse } from "next/server";
import type { UTCTimestamp } from "lightweight-charts";
import {
  aggregateToInterval,
  dateToYYYYMMDD,
  fetchDailyBars,
  fetchMinuteBarsForDate,
  fetchOneMinuteBars,
  previousTradingDateYYYYMMDD,
  type Bar,
  type DailyBar,
} from "@/lib/kis/candles";
import {
  earliestDailyDate,
  latestBarTime,
  latestDailyDate,
  logFetch,
  selectBars,
  selectDailyBars,
  upsertBars,
  upsertDailyBars,
} from "@/lib/db/candles";
import { INTRADAY_MINUTES, isValidTimeframe } from "@/lib/timeframes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const INITIAL_DAYS_BACK = 3;
const MAX_HISTORY_DAYS = 7;
// 클라이언트가 15s 폴링 → 서버는 60s 지나면 KIS 재호출해 최신 1분봉 수급.
// 1m 데이터의 의미 단위 자체가 분 단위라 이 밑으로 내려도 KIS 호출만 늘고 체감 차이 없음.
const TODAY_STALE_MS = 60 * 1000;
const DAILY_INITIAL_RANGE_DAYS = 365;
const DAILY_STALE_DAYS = 7;

function parseSymbol(raw: string | null): string | { error: string } {
  const symbol = (raw ?? "005930").trim();
  if (!/^\d{6}$/.test(symbol)) {
    return { error: `Invalid symbol "${symbol}" — KRX 종목 코드는 6자리 숫자입니다.` };
  }
  return symbol;
}

function isMarketHoursKst(now: Date): boolean {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

function dailyBarToTime(bar: DailyBar): UTCTimestamp {
  const [y, m, d] = bar.tradeDate.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 1000) as UTCTimestamp;
}

function dateAddDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toIntradayResponse(bars: Bar[]) {
  const candles = bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
  const volumes = bars.map((b) => ({
    time: b.time,
    value: b.volume,
    color:
      b.close >= b.open
        ? "rgba(38, 166, 154, 0.5)"
        : "rgba(239, 83, 80, 0.5)",
  }));
  return { candles, volumes };
}

function toDailyResponse(bars: DailyBar[]) {
  const candles = bars.map((b) => ({
    time: dailyBarToTime(b),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
  const volumes = bars.map((b) => ({
    time: dailyBarToTime(b),
    value: b.volume,
    color:
      b.close >= b.open
        ? "rgba(38, 166, 154, 0.5)"
        : "rgba(239, 83, 80, 0.5)",
  }));
  return { candles, volumes };
}

async function loadIntradayRecent(symbol: string): Promise<Bar[]> {
  const to = new Date();
  const from = new Date(to.getTime() - INITIAL_DAYS_BACK * 24 * 60 * 60 * 1000);

  let bars = await selectBars(symbol, { fromUtc: from, toUtc: to });

  const latest = bars.length > 0 ? new Date(bars[bars.length - 1]!.time * 1000) : null;
  const dbFresh =
    latest !== null &&
    (!isMarketHoursKst(new Date()) ||
      Date.now() - latest.getTime() < TODAY_STALE_MS);

  if (bars.length === 0 || !dbFresh) {
    const fetched = await fetchOneMinuteBars(symbol, { maxBars: 300 });
    if (fetched.length > 0) {
      const inserted = await upsertBars(symbol, fetched);
      await logFetch({
        symbol,
        interval: "1m",
        fromUtc: new Date(fetched[0]!.time * 1000),
        toUtc: new Date(fetched[fetched.length - 1]!.time * 1000),
        barCount: inserted,
      });
      bars = await selectBars(symbol, { fromUtc: from, toUtc: to });
    }
  }

  return bars;
}

async function loadIntradayBefore(
  symbol: string,
  beforeSec: number,
): Promise<Bar[]> {
  const beforeDate = new Date(beforeSec * 1000);
  const earliestAllowed = await computeEarliestAllowed(symbol);

  const targetDateKst = previousTradingDateYYYYMMDD(beforeDate);
  const targetDateMs = Date.UTC(
    Number(targetDateKst.slice(0, 4)),
    Number(targetDateKst.slice(4, 6)) - 1,
    Number(targetDateKst.slice(6, 8)),
  );
  const dayStart = new Date(targetDateMs - KST_OFFSET_MS);
  const dayEnd = new Date(targetDateMs - KST_OFFSET_MS + 24 * 60 * 60 * 1000);

  if (dayStart.getTime() < earliestAllowed.getTime()) {
    return selectBars(symbol, {
      fromUtc: earliestAllowed,
      toUtc: beforeDate,
    });
  }

  const existing = await selectBars(symbol, {
    fromUtc: dayStart,
    toUtc: dayEnd,
  });

  if (existing.length >= 60) {
    return selectBars(symbol, {
      fromUtc: earliestAllowed,
      toUtc: beforeDate,
    });
  }

  const fetched = await fetchMinuteBarsForDate(symbol, targetDateKst);
  if (fetched.length > 0) {
    const inserted = await upsertBars(symbol, fetched);
    await logFetch({
      symbol,
      interval: "1m",
      fromUtc: new Date(fetched[0]!.time * 1000),
      toUtc: new Date(fetched[fetched.length - 1]!.time * 1000),
      barCount: inserted,
    });
  }

  return selectBars(symbol, {
    fromUtc: earliestAllowed,
    toUtc: beforeDate,
  });
}

async function computeEarliestAllowed(symbol: string): Promise<Date> {
  const latest = (await latestBarTime(symbol)) ?? new Date();
  return new Date(
    latest.getTime() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000,
  );
}

async function loadDailyRecent(symbol: string): Promise<DailyBar[]> {
  const now = new Date();
  const fromDate = dateAddDays(now, -DAILY_INITIAL_RANGE_DAYS);
  const fromStr = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-${String(fromDate.getUTCDate()).padStart(2, "0")}`;

  const latestStr = await latestDailyDate(symbol);
  const dbFresh =
    latestStr !== null &&
    (() => {
      const [y, m, d] = latestStr.split("-").map(Number);
      const latestMs = Date.UTC(y!, m! - 1, d!);
      const ageDays = (Date.now() - latestMs) / (24 * 60 * 60 * 1000);
      return ageDays < DAILY_STALE_DAYS;
    })();

  if (!dbFresh) {
    const fetched = await fetchDailyBars({
      symbol,
      period: "D",
      fromYYYYMMDD: dateToYYYYMMDD(fromDate),
      toYYYYMMDD: dateToYYYYMMDD(now),
    });
    if (fetched.length > 0) {
      const inserted = await upsertDailyBars(symbol, fetched);
      await logFetch({
        symbol,
        interval: "1d",
        fromUtc: new Date(fetched[0]!.tradeDate + "T00:00:00Z"),
        toUtc: new Date(fetched[fetched.length - 1]!.tradeDate + "T00:00:00Z"),
        barCount: inserted,
      });
    }
  }

  return selectDailyBars(symbol, { fromDate: fromStr });
}

async function loadDailyBefore(
  symbol: string,
  beforeSec: number,
): Promise<DailyBar[]> {
  const beforeDate = new Date(beforeSec * 1000);
  const toDate = dateAddDays(beforeDate, -1);
  const fromDate = dateAddDays(toDate, -DAILY_INITIAL_RANGE_DAYS);

  const toStr = `${toDate.getUTCFullYear()}-${String(toDate.getUTCMonth() + 1).padStart(2, "0")}-${String(toDate.getUTCDate()).padStart(2, "0")}`;
  const fromStr = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-${String(fromDate.getUTCDate()).padStart(2, "0")}`;

  const earliestStr = await earliestDailyDate(symbol);
  const needFetch = !earliestStr || earliestStr > fromStr;

  if (needFetch) {
    const fetched = await fetchDailyBars({
      symbol,
      period: "D",
      fromYYYYMMDD: dateToYYYYMMDD(fromDate),
      toYYYYMMDD: dateToYYYYMMDD(toDate),
    });
    if (fetched.length > 0) {
      const inserted = await upsertDailyBars(symbol, fetched);
      await logFetch({
        symbol,
        interval: "1d",
        fromUtc: new Date(fetched[0]!.tradeDate + "T00:00:00Z"),
        toUtc: new Date(fetched[fetched.length - 1]!.tradeDate + "T00:00:00Z"),
        barCount: inserted,
      });
    }
  }

  return selectDailyBars(symbol, { fromDate: fromStr, toDate: toStr });
}

function aggregateDailyTo10d(bars: DailyBar[]): DailyBar[] {
  if (bars.length === 0) return bars;
  const out: DailyBar[] = [];
  for (let i = 0; i < bars.length; i += 10) {
    const slice = bars.slice(i, i + 10);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    out.push({
      tradeDate: first.tradeDate,
      open: first.open,
      high: Math.max(...slice.map((b) => b.high)),
      low: Math.min(...slice.map((b) => b.low)),
      close: last.close,
      volume: slice.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  return out;
}

function aggregateDailyToMonthly(bars: DailyBar[]): DailyBar[] {
  if (bars.length === 0) return bars;
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const key = bar.tradeDate.slice(0, 7);
    const arr = groups.get(key) ?? [];
    arr.push(bar);
    groups.set(key, arr);
  }

  const out: DailyBar[] = [];
  for (const [ym, slice] of Array.from(groups.entries()).sort()) {
    slice.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    out.push({
      tradeDate: `${ym}-01`,
      open: first.open,
      high: Math.max(...slice.map((b) => b.high)),
      low: Math.min(...slice.map((b) => b.low)),
      close: last.close,
      volume: slice.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const symbolParsed = parseSymbol(url.searchParams.get("symbol"));
  if (typeof symbolParsed !== "string") {
    return NextResponse.json({ error: symbolParsed.error }, { status: 400 });
  }
  const symbol = symbolParsed;

  const intervalKey = (url.searchParams.get("interval") ?? "5m").trim();
  if (!isValidTimeframe(intervalKey)) {
    return NextResponse.json(
      { error: `Unsupported interval "${intervalKey}".` },
      { status: 400 },
    );
  }

  const beforeRaw = url.searchParams.get("before");
  const beforeSec = beforeRaw ? Number(beforeRaw) : null;
  if (beforeRaw && (!Number.isFinite(beforeSec) || beforeSec! <= 0)) {
    return NextResponse.json(
      { error: `Invalid before="${beforeRaw}".` },
      { status: 400 },
    );
  }

  try {
    const minutes = INTRADAY_MINUTES[intervalKey];
    if (minutes !== undefined) {
      const raw =
        beforeSec !== null
          ? await loadIntradayBefore(symbol, beforeSec)
          : await loadIntradayRecent(symbol);
      const aggregated = aggregateToInterval(raw, minutes);
      const { candles, volumes } = toIntradayResponse(aggregated);
      return NextResponse.json({
        symbol,
        interval: intervalKey,
        kind: "intraday",
        count: aggregated.length,
        before: beforeSec,
        candles,
        volumes,
      });
    }

    const dailyRaw =
      beforeSec !== null
        ? await loadDailyBefore(symbol, beforeSec)
        : await loadDailyRecent(symbol);

    const aggregated =
      intervalKey === "10d"
        ? aggregateDailyTo10d(dailyRaw)
        : intervalKey === "1mo"
          ? aggregateDailyToMonthly(dailyRaw)
          : dailyRaw;

    const { candles, volumes } = toDailyResponse(aggregated);
    return NextResponse.json({
      symbol,
      interval: intervalKey,
      kind: "daily",
      count: aggregated.length,
      before: beforeSec,
      candles,
      volumes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
