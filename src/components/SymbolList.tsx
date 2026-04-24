"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TierBadge from "./TierBadge";
import { useSymbolList, type SymbolSummary } from "@/hooks/useSymbols";
import { sectorLabel, sectorSortWeight } from "@/lib/sectors";

type Tab = "ALL" | "S" | "A" | "B";
const TABS: Tab[] = ["ALL", "S", "A", "B"];

type Props = {
  currentSymbol: string | null;
};

function groupBySector(items: SymbolSummary[]): Record<string, SymbolSummary[]> {
  const out: Record<string, SymbolSummary[]> = {};
  for (const s of items) {
    const key = sectorLabel(s.sector);
    if (!out[key]) out[key] = [];
    out[key].push(s);
  }
  return out;
}

export default function SymbolList({ currentSymbol }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("ALL");
  const [groupBy, setGroupBy] = useState<"none" | "sector">("none");
  const [collapsedSectors, setCollapsedSectors] = useState<Set<string>>(new Set());

  const { symbols, byTier, total, loading, error } = useSymbolList({ tier: tab });

  const grouped = useMemo(() => groupBySector(symbols), [symbols]);
  const sectorKeys = useMemo(
    () =>
      Object.keys(grouped).sort((a, b) => {
        const wa = sectorSortWeight(a);
        const wb = sectorSortWeight(b);
        if (wa !== wb) return wa - wb;
        return grouped[b]!.length - grouped[a]!.length;
      }),
    [grouped],
  );

  const gotoSymbol = (code: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("symbol", code);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const toggleSector = (sector: string) => {
    setCollapsedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-0.5 text-xs">
          {TABS.map((t) => {
            const active = tab === t;
            const count =
              t === "ALL"
                ? (byTier.S ?? 0) + (byTier.A ?? 0) + (byTier.B ?? 0)
                : byTier[t] ?? 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  active
                    ? "rounded bg-[#2a2f3d] px-2 py-1 font-medium text-white"
                    : "rounded px-2 py-1 text-muted hover:bg-[#1b1f2a] hover:text-white"
                }
              >
                {t} <span className="text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setGroupBy(groupBy === "none" ? "sector" : "none")}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-white"
          title="섹터 그룹핑 토글"
        >
          {groupBy === "sector" ? "그룹 해제" : "섹터별"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto text-xs">
        {loading && <div className="px-3 py-4 text-muted">불러오는 중…</div>}
        {error && <div className="px-3 py-4 text-down">오류: {error}</div>}

        {!loading && !error && groupBy === "none" && (
          <ul className="divide-y divide-border">
            {symbols.map((s) => (
              <SymbolRow
                key={`${s.code}-${s.tier}`}
                item={s}
                active={s.code === currentSymbol}
                onClick={() => gotoSymbol(s.code)}
              />
            ))}
            {symbols.length === 0 && (
              <li className="px-3 py-4 text-muted">없음</li>
            )}
          </ul>
        )}

        {!loading && !error && groupBy === "sector" && (
          <div>
            {sectorKeys.map((sector) => {
              const list = grouped[sector]!;
              const collapsed = collapsedSectors.has(sector);
              return (
                <section key={sector} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => toggleSector(sector)}
                    className="sticky top-0 z-10 flex w-full items-center justify-between border-l-[3px] border-[#2962FF] bg-[#131a28] px-3 py-2 text-[13px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.04)] hover:bg-[#17213a]"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="uppercase tracking-wide">{sector}</span>
                      <span className="rounded bg-[#2962FF]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#7aa2ff]">
                        {list.length}
                      </span>
                    </span>
                    <span className="text-muted">{collapsed ? "▸" : "▾"}</span>
                  </button>
                  {!collapsed && (
                    <ul className="divide-y divide-border">
                      {list.map((s) => (
                        <SymbolRow
                          key={`${s.code}-${s.tier}`}
                          item={s}
                          active={s.code === currentSymbol}
                          onClick={() => gotoSymbol(s.code)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted">
        총 {total}종목 · tab={tab}
      </div>
    </div>
  );
}

function SymbolRow({
  item,
  active,
  onClick,
}: {
  item: SymbolSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          (active
            ? "bg-[#162036] "
            : "hover:bg-[#0f1218] ") +
          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left"
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <TierBadge tier={item.tier} />
          <span className="min-w-0 truncate">
            <span className="font-mono text-[11px] text-muted">{item.code}</span>
            <span className="ml-2 text-white">{item.name}</span>
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-muted">{item.market}</span>
      </button>
    </li>
  );
}
