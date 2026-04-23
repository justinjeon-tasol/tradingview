import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lightweight Charts Playground",
  description: "TradingView Lightweight Charts base app",
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
