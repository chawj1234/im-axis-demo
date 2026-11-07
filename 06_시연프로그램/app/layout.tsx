import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iM 문서 검증 · 프로토타입",
  description: "대출 문서의 분석부터 고객 안내와 담당자 검토까지 연결하는 로컬 데모",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
