import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stockchart.jeons.kr"),
  title: "StockChart — KRX 실시간 차트",
  description: "KIS OpenAPI 기반 코스피/코스닥 캔들 + 투자자 수급",
  openGraph: {
    title: "StockChart — KRX 실시간 차트",
    description: "KIS OpenAPI 기반 코스피/코스닥 캔들 + 투자자 수급",
    url: "https://stockchart.jeons.kr",
    siteName: "StockChart",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "StockChart — KRX 실시간 차트",
    description: "KIS OpenAPI 기반 코스피/코스닥 캔들 + 투자자 수급",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-background text-[#d1d4dc]">
        {children}
      </body>
    </html>
  );
}
