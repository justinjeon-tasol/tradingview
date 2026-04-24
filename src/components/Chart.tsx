"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TimeframeValue } from "@/lib/timeframes";
import TimeframeToggle from "./TimeframeToggle";

const priceFmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const formatPrice = (p: number) => priceFmt.format(Math.round(p));

type ApiResponse = {
  symbol: string;
  interval: string;
  count: number;
  before: number | null;
  candles: CandlestickData<UTCTimestamp>[];
  volumes: HistogramData<UTCTimestamp>[];
};

type ChartProps = {
  symbol?: string;
  interval?: string;
};

const PREPEND_THRESHOLD_BARS = 15;
const MAX_PREPEND_ATTEMPTS = 7;

export default function Chart({
  symbol = "005930",
  interval = "5m",
}: ChartProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleTimeframeClick = (next: TimeframeValue) => {
    if (next === interval) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tf", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candleDataRef = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const volumeDataRef = useRef<HistogramData<UTCTimestamp>[]>([]);
  const loadingOlderRef = useRef(false);
  const exhaustedRef = useRef(false);
  const prependAttemptsRef = useRef(0);

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string>("");
  const [meta, setMeta] = useState<{ count: number } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  async function fetchBars(params: {
    symbol: string;
    interval: string;
    before?: number;
    signal?: AbortSignal;
  }): Promise<ApiResponse | { error: string }> {
    const u = new URL("/api/candles", window.location.origin);
    u.searchParams.set("symbol", params.symbol);
    u.searchParams.set("interval", params.interval);
    if (params.before !== undefined) {
      u.searchParams.set("before", String(params.before));
    }
    const res = await fetch(u.toString(), {
      signal: params.signal,
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok || "error" in body) return body;
    return body as ApiResponse;
  }

  function mergeCandles(
    existing: CandlestickData<UTCTimestamp>[],
    incoming: CandlestickData<UTCTimestamp>[],
  ): CandlestickData<UTCTimestamp>[] {
    const map = new Map<number, CandlestickData<UTCTimestamp>>();
    for (const bar of existing) map.set(bar.time as number, bar);
    for (const bar of incoming) map.set(bar.time as number, bar);
    return Array.from(map.values()).sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
  }

  function mergeVolumes(
    existing: HistogramData<UTCTimestamp>[],
    incoming: HistogramData<UTCTimestamp>[],
  ): HistogramData<UTCTimestamp>[] {
    const map = new Map<number, HistogramData<UTCTimestamp>>();
    for (const v of existing) map.set(v.time as number, v);
    for (const v of incoming) map.set(v.time as number, v);
    return Array.from(map.values()).sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e13" },
        textColor: "#d1d4dc",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: "#1f2430" },
        horzLines: { color: "#1f2430" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          labelBackgroundColor: "#2962FF",
        },
        horzLine: {
          labelBackgroundColor: "#2962FF",
        },
      },
      rightPriceScale: {
        borderColor: "#1f2430",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "#1f2430",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 6,
        minBarSpacing: 2,
      },
      localization: {
        priceFormatter: formatPrice,
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineWidth: 1,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const onRangeChange = async (range: LogicalRange | null) => {
      if (!range) return;
      if (loadingOlderRef.current || exhaustedRef.current) return;
      if (prependAttemptsRef.current >= MAX_PREPEND_ATTEMPTS) return;
      if (range.from > PREPEND_THRESHOLD_BARS) return;
      if (candleDataRef.current.length === 0) return;

      loadingOlderRef.current = true;
      setLoadingOlder(true);
      prependAttemptsRef.current += 1;

      try {
        const earliest = candleDataRef.current[0]!.time as number;
        const resp = await fetchBars({
          symbol,
          interval,
          before: earliest,
        });
        if ("error" in resp) {
          setMessage(resp.error);
          return;
        }
        if (resp.candles.length === 0) {
          exhaustedRef.current = true;
          return;
        }

        const merged = mergeCandles(candleDataRef.current, resp.candles);
        const mergedVol = mergeVolumes(volumeDataRef.current, resp.volumes);

        if (merged.length === candleDataRef.current.length) {
          exhaustedRef.current = true;
          return;
        }

        candleDataRef.current = merged;
        volumeDataRef.current = mergedVol;
        candleRef.current?.setData(merged);
        volumeRef.current?.setData(mergedVol);
        setMeta({ count: merged.length });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      candleDataRef.current = [];
      volumeDataRef.current = [];
    };
  }, [symbol, interval]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setMessage("");
    exhaustedRef.current = false;
    prependAttemptsRef.current = 0;
    candleDataRef.current = [];
    volumeDataRef.current = [];

    (async () => {
      try {
        const resp = await fetchBars({
          symbol,
          interval,
          signal: controller.signal,
        });
        if ("error" in resp) {
          setStatus("error");
          setMessage(resp.error);
          return;
        }

        candleDataRef.current = resp.candles;
        volumeDataRef.current = resp.volumes;
        candleRef.current?.setData(resp.candles);
        volumeRef.current?.setData(resp.volumes);
        chartRef.current?.timeScale().fitContent();
        setMeta({ count: resp.count });
        setStatus("ready");
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => controller.abort();
  }, [symbol, interval]);

  useEffect(() => {
    if (status !== "ready") return;

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const POLL_MS = 15_000;

    const inMarketHours = () => {
      const kst = new Date(Date.now() + KST_OFFSET_MS);
      const day = kst.getUTCDay();
      if (day === 0 || day === 6) return false;
      const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      return mins >= 9 * 60 && mins <= 15 * 60 + 35;
    };

    const tick = async () => {
      if (!inMarketHours()) return;
      if (loadingOlderRef.current) return;
      try {
        const resp = await fetchBars({ symbol, interval });
        if ("error" in resp || resp.candles.length === 0) return;

        const existing = candleDataRef.current;
        const lastExistingTime =
          existing.length > 0 ? (existing[existing.length - 1]!.time as number) : -1;

        const newCandles = resp.candles.filter(
          (b) => (b.time as number) >= lastExistingTime,
        );
        const newVolumes = resp.volumes.filter(
          (v) => (v.time as number) >= lastExistingTime,
        );
        if (newCandles.length === 0) return;

        for (const bar of newCandles) candleRef.current?.update(bar);
        for (const v of newVolumes) volumeRef.current?.update(v);

        candleDataRef.current = mergeCandles(existing, newCandles);
        volumeDataRef.current = mergeVolumes(volumeDataRef.current, newVolumes);
        setMeta({ count: candleDataRef.current.length });
      } catch {
        // 폴링 실패는 조용히 무시 — 다음 tick에서 재시도
      }
    };

    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [status, symbol, interval]);

  return (
    <div className="relative">
      <TimeframeToggle
        value={interval as TimeframeValue}
        onChange={handleTimeframeClick}
        className="mb-2"
      />

      <div
        ref={containerRef}
        className="h-[70vh] w-full rounded-lg border border-border bg-panel"
      />
      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="text-muted">
          {symbol} · {interval}
          {meta ? ` · ${meta.count} bars` : ""}
        </div>
        <div className="flex items-center gap-3">
          {loadingOlder && (
            <span className="text-muted">과거 데이터 불러오는 중…</span>
          )}
          {status === "loading" && (
            <span className="text-muted">불러오는 중…</span>
          )}
          {status === "ready" && !loadingOlder && (
            <span className="text-up">● live</span>
          )}
          {status === "error" && (
            <span className="text-down">오류: {message}</span>
          )}
        </div>
      </div>
    </div>
  );
}

