export const TIMEFRAMES = [
  { value: "1m", label: "1분", kind: "intraday" },
  { value: "5m", label: "5분", kind: "intraday" },
  { value: "15m", label: "15분", kind: "intraday" },
  { value: "30m", label: "30분", kind: "intraday" },
  { value: "60m", label: "1시간", kind: "intraday" },
  { value: "1d", label: "1일", kind: "daily" },
  { value: "10d", label: "10일", kind: "daily" },
  { value: "1mo", label: "1달", kind: "daily" },
] as const;

export type TimeframeValue = (typeof TIMEFRAMES)[number]["value"];
export type TimeframeKind = "intraday" | "daily";

export function isValidTimeframe(v: string): v is TimeframeValue {
  return TIMEFRAMES.some((t) => t.value === v);
}

export function timeframeKind(tf: TimeframeValue): TimeframeKind {
  return TIMEFRAMES.find((t) => t.value === tf)!.kind;
}

export const INTRADAY_MINUTES: Record<string, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "10m": 10,
  "15m": 15,
  "30m": 30,
  "60m": 60,
};
