import Chart from "@/components/Chart";
import SymbolList from "@/components/SymbolList";
import SymbolSearch from "@/components/SymbolSearch";
import { sql } from "@/lib/db/pool";
import { isValidTimeframe } from "@/lib/timeframes";

type SearchParams = Promise<{
  tf?: string;
  symbol?: string;
}>;

async function resolveName(code: string): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM symbols WHERE code = ${code} LIMIT 1
  `;
  return rows[0]?.name ?? null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const interval =
    params.tf && isValidTimeframe(params.tf) ? params.tf : "5m";
  const symbol =
    params.symbol && /^\d{6}$/.test(params.symbol) ? params.symbol : "005930";
  const name = await resolveName(symbol).catch(() => null);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-panel/40 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            {symbol} <span className="text-muted">·</span>{" "}
            <span className="text-white">{name ?? "—"}</span>
          </h1>
          <span className="text-xs text-muted">
            KRX · KIS OpenAPI · 1분봉 저장 / 집계 제공
          </span>
        </div>
        <div className="w-80">
          <SymbolSearch />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
        <aside className="min-h-0 border-r border-border bg-panel/20">
          <SymbolList currentSymbol={symbol} />
        </aside>

        <section className="min-h-0 overflow-hidden p-4">
          <Chart symbol={symbol} interval={interval} />
        </section>
      </main>
    </div>
  );
}
