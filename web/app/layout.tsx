import type { ReactNode } from "react";
import { displayFont, bodyFont, numberFont } from "./lib/fonts";
import "./globals.css";

export const metadata = {
  title: "여행 가격비교 — 한국에서 살까, 일본에서 살까",
  description: "여행 가기 전 실제로 확인된 가격으로 한국·일본을 비교합니다.",
};

// Root layout stays deliberately thin: no shared header here. The
// consumer site (app/(site)) and the admin tool (app/admin) each get
// their own layout so restyling the public site can never bleed into
// /admin - see app/(site)/layout.tsx and app/admin/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${displayFont.variable} ${bodyFont.variable} ${numberFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
