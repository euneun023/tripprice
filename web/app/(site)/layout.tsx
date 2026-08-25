import type { ReactNode } from "react";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { GA_MEASUREMENT_ID } from "../lib/analytics";
import "./site.css";

// Scoped to the public site layout (not root layout) on purpose: /admin
// renders under its own layout and never picks this up, so admin traffic
// never mixes into GA4's user-behavior data.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site site-shell">
      <Header />
      <main className="site-main">{children}</main>
      <Footer />
      {GA_MEASUREMENT_ID && (
        <>
          {/* Consent Mode default: without this, gtag.js defaults every
           * event to analytics_storage "denied" (Google's own baseline,
           * confirmed empirically - only the automatic page_view "ping"
           * gets sent; select_item/view_item/seller_click/search_submit are
           * all silently dropped). This site has no ads/remarketing use of
           * GA4 and no cookie-consent banner yet, so analytics is granted
           * by default and ad-related storage stays denied. Must run
           * before <GoogleAnalytics>'s own init script. */}
          <Script id="ga-consent-default" strategy="beforeInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('consent', 'default', {
                analytics_storage: 'granted',
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied'
              });`}
          </Script>
          <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
        </>
      )}
    </div>
  );
}
