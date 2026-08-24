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

/** Proper hinomaru: white field, red disc centered, diameter = 3/5 of height
 * (official ratio) - just a small marker, not a strong brand color block. */
export function FlagJP() {
  return (
    <span className="flag-chip" style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg width={16} height={11} viewBox="0 0 30 20">
        <rect width="30" height="20" rx="2.5" fill="#FFFFFF" />
        <rect x="0.5" y="0.5" width="29" height="19" rx="2" fill="none" stroke="#E2E5EC" />
        <circle cx="15" cy="10" r="6" fill="#BC002D" />
      </svg>
    </span>
  );
}

/** Proper taegukgi: white field, red/blue taegeuk, and all four trigrams
 * (건/곤/감/리) so it isn't confusable with the hinomaru at small sizes. */
export function FlagKR() {
  const line = "#333B4D";
  return (
    <span className="flag-chip" style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg width={16} height={11} viewBox="0 0 30 20">
        <rect width="30" height="20" rx="2.5" fill="#FFFFFF" />
        <rect x="0.5" y="0.5" width="29" height="19" rx="2" fill="none" stroke="#E2E5EC" />
        <path d="M10.5 10 A4.5 4.5 0 0 1 19.5 10 A2.25 2.25 0 0 1 15 10 A2.25 2.25 0 0 0 10.5 10 Z" fill="#CD2E3A" />
        <path d="M19.5 10 A4.5 4.5 0 0 1 10.5 10 A2.25 2.25 0 0 1 15 10 A2.25 2.25 0 0 0 19.5 10 Z" fill="#0047A0" />

        {/* 건 (top-left, ☰ - three solid bars) */}
        <rect x="2" y="2.2" width="7" height="1.1" fill={line} />
        <rect x="2" y="4" width="7" height="1.1" fill={line} />
        <rect x="2" y="5.8" width="7" height="1.1" fill={line} />

        {/* 감 (top-right, ☵ - broken / solid / broken) */}
        <rect x="21" y="2.2" width="3" height="1.1" fill={line} />
        <rect x="25" y="2.2" width="3" height="1.1" fill={line} />
        <rect x="21" y="4" width="7" height="1.1" fill={line} />
        <rect x="21" y="5.8" width="3" height="1.1" fill={line} />
        <rect x="25" y="5.8" width="3" height="1.1" fill={line} />

        {/* 리 (bottom-left, ☲ - solid / broken / solid) */}
        <rect x="2" y="13.1" width="7" height="1.1" fill={line} />
        <rect x="2" y="14.9" width="3" height="1.1" fill={line} />
        <rect x="6" y="14.9" width="3" height="1.1" fill={line} />
        <rect x="2" y="16.7" width="7" height="1.1" fill={line} />

        {/* 곤 (bottom-right, ☷ - three broken bars) */}
        <rect x="21" y="13.1" width="3" height="1.1" fill={line} />
        <rect x="25" y="13.1" width="3" height="1.1" fill={line} />
        <rect x="21" y="14.9" width="3" height="1.1" fill={line} />
        <rect x="25" y="14.9" width="3" height="1.1" fill={line} />
        <rect x="21" y="16.7" width="3" height="1.1" fill={line} />
        <rect x="25" y="16.7" width="3" height="1.1" fill={line} />
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
