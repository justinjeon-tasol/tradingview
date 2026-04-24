"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SymbolSummary = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  sector: string | null;
  tier: "S" | "A" | "B" | null;
  inUniverse?: boolean;
};

type SearchResponse = { symbols: SymbolSummary[] };
type ListResponse = {
  symbols: SymbolSummary[];
  byTier: Record<string, number>;
  bySector: Record<string, number>;
  total: number;
};

type UseSearchResult = {
  query: string;
  setQuery: (q: string) => void;
  results: SymbolSummary[];
  loading: boolean;
  error: string | null;
};

export function useSymbolSearch(options: { debounceMs?: number; limit?: number } = {}): UseSearchResult {
  const { debounceMs = 300, limit = 10 } = options;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const url = `/api/symbols/search?q=${encodeURIComponent(query)}&limit=${limit}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as SearchResponse;
        setResults(body.symbols);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debounceMs, limit]);

  return { query, setQuery, results, loading, error };
}

type UseListParams = { tier?: "S" | "A" | "B" | "ALL"; sector?: string };
type UseListResult = {
  symbols: SymbolSummary[];
  byTier: Record<string, number>;
  bySector: Record<string, number>;
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useSymbolList(params: UseListParams = {}): UseListResult {
  const { tier = "ALL", sector = "" } = params;
  const [data, setData] = useState<ListResponse>({
    symbols: [],
    byTier: {},
    bySector: {},
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (tier && tier !== "ALL") params.set("tier", tier);
    if (sector) params.set("sector", sector);

    fetch(`/api/symbols/list?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ListResponse;
        setData(body);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [tier, sector, reloadKey]);

  return { ...data, loading, error, reload };
}
