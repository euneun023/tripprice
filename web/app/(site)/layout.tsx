import type { ReactNode } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import "./site.css";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site site-shell">
      <Header />
      <main className="site-main">{children}</main>
      <Footer />
    </div>
  );
}
