"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TierBadge from "./TierBadge";
import { useSymbolSearch } from "@/hooks/useSymbols";

export default function SymbolSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, results, loading } = useSymbolSearch();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [results]);

  const pick = (code: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("symbol", code);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[cursor];
      if (item) pick(item.code);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="종목 검색 (이름 또는 6자리 코드)"
        className="w-full rounded border border-border bg-panel px-3 py-2 text-sm text-white placeholder:text-muted focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
      />

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded border border-border bg-panel shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-xs text-muted">검색 중…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted">결과 없음</div>
          )}
          {!loading &&
            results.map((s, i) => (
              <button
                key={s.code}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.code);
                }}
                onMouseEnter={() => setCursor(i)}
                className={
                  (i === cursor ? "bg-[#162036] " : "") +
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#162036]"
                }
              >
                <div className="flex min-w-0 items-center gap-2">
                  <TierBadge tier={s.tier} />
                  <span className="font-mono text-[11px] text-muted">
                    {s.code}
                  </span>
                  <span className="truncate text-white">{s.name}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted">
                  {s.market}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
