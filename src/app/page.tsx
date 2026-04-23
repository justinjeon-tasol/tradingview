import Chart from "@/components/Chart";
import { isValidTimeframe } from "@/lib/timeframes";

type SearchParams = Promise<{
  tf?: string;
  symbol?: string;
}>;

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {symbol} · {symbol === "005930" ? "삼성전자" : "KRX"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            KRX · KIS OpenAPI · 1분봉 저장 · 임의 간격 집계
          </p>
        </div>
        <div className="text-xs text-muted">
          실전 계좌 · 분 단위 집계 · 최대 7일 히스토리
        </div>
      </header>

      <Chart symbol={symbol} interval={interval} />

      <footer className="mt-6 text-xs text-muted">
        다음 단계: 일봉·월봉 데이터, 이동평균·RSI 인디케이터, 실시간 체결 스트림.
      </footer>
    </main>
  );
}
