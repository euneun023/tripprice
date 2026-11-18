import type { Metadata } from "next";
import type { ReactNode } from "react";
import { displayFont, bodyFont, numberFont } from "./lib/fonts";
import { SITE_URL } from "./lib/seo";
import "./globals.css";

// Site-wide fallback only - each public route (home/category/product/search)
// sets its own title/description/canonical via generateMetadata. Admin has
// none, so it inherits this; that's fine, it's excluded from SEO via
// robots.ts, not via a distinct <title>.
export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: "얼마차이 | 한국·일본 상품 가격 비교",
  description: "한국과 일본의 동일 상품 가격을 원화 기준으로 비교해 어디서 사는 게 더 저렴한지 확인하세요.",
};

// impact.com's domain-ownership verification snippet, provided as:
//   <meta name='impact-site-verification' value='...'/>
// It intentionally uses a non-standard `value` attribute instead of
// `content` - the Metadata API's `other` field (metadata.other) always
// emits `content`, which impact.com's verifier would not recognize, so
// this can't go through the metadata object. Rendered as raw JSX instead;
// React 19 hoists <meta> tags into <head> wherever in the tree they're
// rendered, deduplicated, so no manual <head> element is needed here.
const IMPACT_SITE_VERIFICATION_ID = "0c2be7b3-5898-4434-88a4-3c8c4c59b004";

// Root layout stays deliberately thin: no shared header here. The
// consumer site (app/(site)) and the admin tool (app/admin) each get
// their own layout so restyling the public site can never bleed into
// /admin - see app/(site)/layout.tsx and app/admin/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${displayFont.variable} ${bodyFont.variable} ${numberFont.variable}`}>
      <body>
        <meta
          name="impact-site-verification"
          {...({ value: IMPACT_SITE_VERIFICATION_ID } as Record<string, string>)}
        />
        {children}
      </body>
    </html>
  );
}
