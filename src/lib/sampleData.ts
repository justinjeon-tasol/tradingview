import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";

type Candle = CandlestickData<UTCTimestamp>;
type Volume = HistogramData<UTCTimestamp>;

export function generateCandles(
  count = 300,
  startPrice = 100,
  startDate = new Date("2024-01-01T00:00:00Z"),
): { candles: Candle[]; volumes: Volume[] } {
  const candles: Candle[] = [];
  const volumes: Volume[] = [];

  let price = startPrice;
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (Math.random() - 0.48) * 2;
    const volatility = Math.max(0.3, Math.abs((Math.random() - 0.5) * 4));
    const high = open + Math.random() * volatility + Math.max(0, drift);
    const low = open - Math.random() * volatility + Math.min(0, drift);
    const close = low + Math.random() * (high - low);

    const time = Math.floor(
      (startDate.getTime() + i * dayMs) / 1000,
    ) as UTCTimestamp;

    candles.push({
      time,
      open: +open.toFixed(2),
      high: +Math.max(open, high, close).toFixed(2),
      low: +Math.min(open, low, close).toFixed(2),
      close: +close.toFixed(2),
    });

    const isUp = close >= open;
    volumes.push({
      time,
      value: Math.round(1_000_000 + Math.random() * 5_000_000),
      color: isUp ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
    });

    price = close;
  }

  return { candles, volumes };
}
