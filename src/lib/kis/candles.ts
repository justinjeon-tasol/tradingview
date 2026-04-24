import type { UTCTimestamp } from "lightweight-charts";
import { KIS_BASE_URL, requireCreds } from "./config";
import { getAccessToken } from "./token";

export type Bar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type KisMinuteRow = {
  stck_bsop_date: string;
  stck_cntg_hour: string;
  stck_prpr: string;
  stck_oprc: string;
  stck_hgpr: string;
  stck_lwpr: string;
  cntg_vol: string;
};

type KisMinuteResponse = {
  rt_cd: string;
  msg_cd?: string;
  msg1?: string;
  output1?: unknown;
  output2?: KisMinuteRow[];
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KIS_CHUNK_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kstDateToUtcSeconds(dateYYYYMMDD: string, timeHHMMSS: string): number {
  const y = Number(dateYYYYMMDD.slice(0, 4));
  const m = Number(dateYYYYMMDD.slice(4, 6));
  const d = Number(dateYYYYMMDD.slice(6, 8));
  const hh = Number(timeHHMMSS.slice(0, 2));
  const mm = Number(timeHHMMSS.slice(2, 4));
  const ss = Number(timeHHMMSS.slice(4, 6));
  const asUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Math.floor((asUtcMs - KST_OFFSET_MS) / 1000);
}

async function fetchMinuteChunk(params: {
  symbol: string;
  hourHHMMSS: string;
}): Promise<Bar[]> {
  const { symbol, hourHHMMSS } = params;
  const token = await getAccessToken();
  const { appKey, appSecret } = requireCreds();

  const url = new URL(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`,
  );
  url.searchParams.set("FID_ETC_CLS_CODE", "");
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", symbol);
  url.searchParams.set("FID_INPUT_HOUR_1", hourHHMMSS);
  url.searchParams.set("FID_PW_DATA_INCU_YN", "Y");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST03010200",
      custtype: "P",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS minute chart HTTP ${res.status}: ${res.statusText} ${text}`,
    );
  }

  const body = (await res.json()) as KisMinuteResponse;
  if (body.rt_cd !== "0") {
    throw new Error(
      `KIS minute chart error: rt_cd=${body.rt_cd} msg_cd=${body.msg_cd ?? ""} msg=${body.msg1 ?? ""}`,
    );
  }

  const rows = body.output2 ?? [];
  const bars: Bar[] = [];
  for (const row of rows) {
    if (!row.stck_bsop_date || !row.stck_cntg_hour) continue;
    const time = kstDateToUtcSeconds(
      row.stck_bsop_date,
      row.stck_cntg_hour,
    ) as UTCTimestamp;
    bars.push({
      time,
      open: Number(row.stck_oprc),
      high: Number(row.stck_hgpr),
      low: Number(row.stck_lwpr),
      close: Number(row.stck_prpr),
      volume: Number(row.cntg_vol),
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

export async function fetchOneMinuteBars(
  symbol: string,
  options: { maxBars?: number } = {},
): Promise<Bar[]> {
  const maxBars = options.maxBars ?? 180;
  const collected = new Map<number, Bar>();
  const nowSec = Math.floor(Date.now() / 1000);

  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const nowHHMM =
    nowKst.getUTCHours() * 60 + nowKst.getUTCMinutes();
  const marketClose = 15 * 60 + 30;
  const hourSource =
    nowHHMM > marketClose
      ? { h: 15, m: 30 }
      : { h: nowKst.getUTCHours(), m: nowKst.getUTCMinutes() };

  const initialHour =
    String(hourSource.h).padStart(2, "0") +
    String(hourSource.m).padStart(2, "0") +
    "00";

  let cursor = initialHour;
  const seenCursors = new Set<string>();
  let isFirst = true;

  while (collected.size < maxBars && !seenCursors.has(cursor)) {
    if (!isFirst) await sleep(KIS_CHUNK_DELAY_MS);
    isFirst = false;

    seenCursors.add(cursor);
    const chunk = await fetchMinuteChunk({ symbol, hourHHMMSS: cursor });
    if (chunk.length === 0) break;

    // KIS의 inquire-time-itemchartprice는 장 시작 전이나 미래 시각 cursor에 대해
    // 직전 거래일 데이터를 오늘 날짜로 리라벨해 돌려준다. 실제 시각 이후 바는 드롭.
    const legitimate = chunk.filter((b) => b.time <= nowSec);
    if (legitimate.length === 0) break;

    for (const bar of legitimate) collected.set(bar.time, bar);

    const earliest = legitimate[0];
    const earliestDate = new Date(earliest.time * 1000 + KST_OFFSET_MS);
    const earliestMins =
      earliestDate.getUTCHours() * 60 + earliestDate.getUTCMinutes();

    // 09:00 (장 시작) 또는 그 이전이면 중단 — 더 요청하면 KIS가 전일 잔재 라벨 오염됨.
    if (earliestMins <= 9 * 60) break;

    earliestDate.setUTCMinutes(earliestDate.getUTCMinutes() - 1);
    cursor =
      String(earliestDate.getUTCHours()).padStart(2, "0") +
      String(earliestDate.getUTCMinutes()).padStart(2, "0") +
      String(earliestDate.getUTCSeconds()).padStart(2, "0");
  }

  const bars = Array.from(collected.values())
    .filter((b) => b.time <= nowSec)
    .sort((a, b) => a.time - b.time);
  return bars.slice(-maxBars);
}

async function fetchHistoricalMinuteChunk(params: {
  symbol: string;
  dateYYYYMMDD: string;
  hourHHMMSS: string;
}): Promise<Bar[]> {
  const { symbol, dateYYYYMMDD, hourHHMMSS } = params;
  const token = await getAccessToken();
  const { appKey, appSecret } = requireCreds();

  const url = new URL(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice`,
  );
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", symbol);
  url.searchParams.set("FID_INPUT_DATE_1", dateYYYYMMDD);
  url.searchParams.set("FID_INPUT_HOUR_1", hourHHMMSS);
  url.searchParams.set("FID_PW_DATA_INCU_YN", "Y");
  url.searchParams.set("FID_FAKE_TICK_INCU_YN", "N");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST03010230",
      custtype: "P",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS historical minute chart HTTP ${res.status}: ${res.statusText} ${text}`,
    );
  }

  const body = (await res.json()) as KisMinuteResponse;
  if (body.rt_cd !== "0") {
    throw new Error(
      `KIS historical minute chart error: rt_cd=${body.rt_cd} msg_cd=${body.msg_cd ?? ""} msg=${body.msg1 ?? ""}`,
    );
  }

  const rows = body.output2 ?? [];
  const bars: Bar[] = [];
  for (const row of rows) {
    if (!row.stck_bsop_date || !row.stck_cntg_hour) continue;
    const time = kstDateToUtcSeconds(
      row.stck_bsop_date,
      row.stck_cntg_hour,
    ) as UTCTimestamp;
    bars.push({
      time,
      open: Number(row.stck_oprc),
      high: Number(row.stck_hgpr),
      low: Number(row.stck_lwpr),
      close: Number(row.stck_prpr),
      volume: Number(row.cntg_vol),
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

export async function fetchMinuteBarsForDate(
  symbol: string,
  dateYYYYMMDD: string,
): Promise<Bar[]> {
  const collected = new Map<number, Bar>();
  let cursor = "153000";
  const seen = new Set<string>();
  let isFirst = true;

  while (!seen.has(cursor)) {
    if (!isFirst) await sleep(KIS_CHUNK_DELAY_MS);
    isFirst = false;
    seen.add(cursor);

    const chunk = await fetchHistoricalMinuteChunk({
      symbol,
      dateYYYYMMDD,
      hourHHMMSS: cursor,
    });
    if (chunk.length === 0) break;
    for (const bar of chunk) collected.set(bar.time, bar);

    const earliest = chunk[0];
    const earliestKst = new Date(earliest.time * 1000 + KST_OFFSET_MS);
    earliestKst.setUTCMinutes(earliestKst.getUTCMinutes() - 1);
    const hh = earliestKst.getUTCHours();
    const mm = earliestKst.getUTCMinutes();

    if (hh < 9) break;

    cursor =
      String(hh).padStart(2, "0") +
      String(mm).padStart(2, "0") +
      "00";
  }

  return Array.from(collected.values()).sort((a, b) => a.time - b.time);
}

type KisDailyRow = {
  stck_bsop_date: string;
  stck_clpr: string;
  stck_oprc: string;
  stck_hgpr: string;
  stck_lwpr: string;
  acml_vol: string;
};

type KisDailyResponse = {
  rt_cd: string;
  msg_cd?: string;
  msg1?: string;
  output1?: unknown;
  output2?: KisDailyRow[];
};

export type DailyBar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DailyPeriod = "D" | "W" | "M" | "Y";

function dailyRowToBar(row: KisDailyRow): DailyBar | null {
  if (!row.stck_bsop_date) return null;
  const y = row.stck_bsop_date.slice(0, 4);
  const m = row.stck_bsop_date.slice(4, 6);
  const d = row.stck_bsop_date.slice(6, 8);
  return {
    tradeDate: `${y}-${m}-${d}`,
    open: Number(row.stck_oprc),
    high: Number(row.stck_hgpr),
    low: Number(row.stck_lwpr),
    close: Number(row.stck_clpr),
    volume: Number(row.acml_vol),
  };
}

export async function fetchDailyBars(params: {
  symbol: string;
  period: DailyPeriod;
  fromYYYYMMDD: string;
  toYYYYMMDD: string;
}): Promise<DailyBar[]> {
  const { symbol, period, fromYYYYMMDD, toYYYYMMDD } = params;
  const token = await getAccessToken();
  const { appKey, appSecret } = requireCreds();

  const url = new URL(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,
  );
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", symbol);
  url.searchParams.set("FID_INPUT_DATE_1", fromYYYYMMDD);
  url.searchParams.set("FID_INPUT_DATE_2", toYYYYMMDD);
  url.searchParams.set("FID_PERIOD_DIV_CODE", period);
  url.searchParams.set("FID_ORG_ADJ_PRC", "0");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST03010100",
      custtype: "P",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS daily chart HTTP ${res.status}: ${res.statusText} ${text}`,
    );
  }

  const body = (await res.json()) as KisDailyResponse;
  if (body.rt_cd !== "0") {
    throw new Error(
      `KIS daily chart error: rt_cd=${body.rt_cd} msg_cd=${body.msg_cd ?? ""} msg=${body.msg1 ?? ""}`,
    );
  }

  const rows = body.output2 ?? [];
  const bars: DailyBar[] = [];
  for (const row of rows) {
    const bar = dailyRowToBar(row);
    if (bar) bars.push(bar);
  }
  bars.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return bars;
}

export function dateToYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function previousTradingDateYYYYMMDD(ref: Date): string {
  const d = new Date(ref.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function aggregateToInterval(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const bucketSec = minutes * 60;
  const buckets = new Map<number, Bar>();

  for (const bar of bars) {
    const bucketTime = (Math.floor(bar.time / bucketSec) *
      bucketSec) as UTCTimestamp;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...bar, time: bucketTime });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
