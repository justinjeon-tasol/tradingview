"use client";

import { TIMEFRAMES, type TimeframeValue } from "@/lib/timeframes";

const INTRADAY = TIMEFRAMES.filter((t) => t.kind === "intraday");
const DAILY = TIMEFRAMES.filter((t) => t.kind === "daily");

type Props = {
  value: TimeframeValue;
  onChange: (next: TimeframeValue) => void;
  id?: string;
  label?: string;
  className?: string;
};

export default function TimeframeToggle({
  value,
  onChange,
  id = "tf-select",
  label = "타임프레임",
  className = "",
}: Props) {
  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as TimeframeValue)}
        className="rounded border border-border bg-panel px-3 py-1.5 text-white focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
      >
        <optgroup label="분봉">
          {INTRADAY.map((tf) => (
            <option key={tf.value} value={tf.value}>
              {tf.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="일봉 이상">
          {DAILY.map((tf) => (
            <option key={tf.value} value={tf.value}>
              {tf.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
