import { Nanum_Myeongjo, Noto_Sans_KR, IBM_Plex_Mono } from "next/font/google";

// Display: an editorial Korean serif with real character - used for
// verdicts and headlines only, never body copy.
export const displayFont = Nanum_Myeongjo({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

// Body/UI: legible Korean grotesk for everything else.
export const bodyFont = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

// Every price on the site renders in this - tabular figures so digits
// align like a real exchange board. This is the site's signature device.
export const numberFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-number",
  display: "swap",
});
