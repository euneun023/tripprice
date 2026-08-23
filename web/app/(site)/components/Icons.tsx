/** Small SVG icons ported from design-reference/eolmachai_final.html.html. */
import type { ReactNode } from "react";

export function SearchIcon({ color = "currentColor", size = 15 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg className="recent-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} width={16} height={16}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} width={12} height={12}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Neutral flag chip - a plain dot, used when the source's market isn't KR/JP (future INTL sources). */
export function CountryDot() {
  return <span className="hc-dot" />;
}

export function FlagJP() {
  return (
    <span className="flag-chip" style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg width={16} height={11} viewBox="0 0 20 14">
        <rect width="20" height="14" rx="3" fill="#F1F2F5" />
        <rect x="0.5" y="0.5" width="19" height="13" rx="2.5" fill="none" stroke="#E2E5EC" />
        <circle cx="10" cy="7" r="3.6" fill="#CE3232" />
      </svg>
    </span>
  );
}

export function FlagKR() {
  return (
    <span className="flag-chip" style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg width={16} height={11} viewBox="0 0 20 14">
        <rect width="20" height="14" rx="3" fill="#F1F2F5" />
        <rect x="0.5" y="0.5" width="19" height="13" rx="2.5" fill="none" stroke="#E2E5EC" />
        <path
          d="M6.4 7 A3.6 3.6 0 0 1 13.6 7 A1.8 1.8 0 0 1 10 7 A1.8 1.8 0 0 0 6.4 7Z"
          fill="#CE3232"
        />
        <path
          d="M13.6 7 A3.6 3.6 0 0 1 6.4 7 A1.8 1.8 0 0 1 10 7 A1.8 1.8 0 0 0 13.6 7Z"
          fill="#144F9C"
        />
      </svg>
    </span>
  );
}

/** region: our Source.region ('KR' | 'JP' | 'INTL') - INTL (and anything else) falls back to a neutral dot, never a guessed flag. */
export function CountryMark({ region }: { region: string | undefined }) {
  if (region === "JP") return <FlagJP />;
  if (region === "KR") return <FlagKR />;
  return <CountryDot />;
}

export const CAT_ICON: Record<string, ReactNode> = {
  electronics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  diving: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="10" r="6" />
      <path d="M9 10a3 3 0 0 1 3-3M12 16v6M9 22h6" />
    </svg>
  ),
  fashion: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 15c1-3 2-5 5-5 2 0 2 2 4 2s2-3 5-3c2 0 3 1.5 4 3l-1 5H4l-1-2Z" />
    </svg>
  ),
  beauty: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M9 2h6l1 4H8l1-4Z" />
      <path d="M8 6h8l1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L8 6Z" />
    </svg>
  ),
};
