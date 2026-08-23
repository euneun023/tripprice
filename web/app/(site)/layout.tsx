import type { ReactNode } from "react";
import { Header } from "./components/Header";
import "./site.css";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <Header />
      {children}
    </div>
  );
}
