import type { MarketComparisonResult, MarketQuote } from "@core/services/marketQuoteService";
import { formatKrw } from "../../lib/format";

/** Groups MarketQuotes by their own marketKey for lookup (e.g. {KR: quote,
 * JP: quote}) - MarketQuotes already arrive pre-grouped/one-per-market from
 * groupIntoMarketQuotes(), so this is a plain array->map reindex, never a
 * second grouping decision. */
export function quoteByRegion(comparison: MarketComparisonResult): Record<string, MarketQuote> {
  const map: Record<string, MarketQuote> = {};
  for (const quote of comparison.marketQuotes) map[quote.marketKey] = quote;
  return map;
}

const REGION_PLACE: Record<string, string> = {
  KR: "한국",
  JP: "일본",
  INTL: "해외직구",
};

/**
 * Phase 2-F1: deliberately never claims a "winner"/"cheapest"/"savings"
 * market - see the read-only F0 audit this follows (marketKey can carry a
 * duplicate active offer or an `estimated`-confidence match with nothing to
 * confirm bundle/condition/mount actually line up, so declaring one side
 * "저렴해요" would overclaim what's actually verified). Every string here
 * only ever states what price was *confirmed*, never which one to choose.
 * A price difference is disclosed as a neutral "차이", never framed as
 * "절약"(savings), and `headlineAllowed`/`diffLine` are gated on
 * MarketComparisonResult.mode === "comparable" (2+ markets, no duplicate
 * market, every contributing offer confidence="verified") - anything less
 * certain still gets its price shown (comparable-unverified) but never a
 * diff/headline claim.
 */
export interface Conclusion {
  /** compact form for list rows (ProductCardGrid) */
  cardLine: string;
  /** full-sentence form for the product page hero */
  headline: string;
  /** "확인한 가격 기준 약 131,803원 차이" - null unless mode === "comparable" */
  diffLine: string | null;
  /** "다른 판매처에서 더 저렴할 수 있습니다" - null when there's no price being
   * shown to disclose against (no-data / duplicate-review-required) */
  disclosure: string | null;
}

const DISCLOSURE = "다른 판매처에서 더 저렴할 수 있습니다";

export function buildConclusion(comparison: MarketComparisonResult): Conclusion {
  if (comparison.mode === "no-data") {
    return {
      cardLine: "가격 정보 없음",
      headline: "아직 비교할 가격 정보가 없어요",
      diffLine: null,
      disclosure: null,
    };
  }

  if (comparison.mode === "duplicate-review-required") {
    return {
      cardLine: "판매처 확인 필요",
      headline: "판매처 확인이 필요해요",
      diffLine: null,
      disclosure: null,
    };
  }

  const places = comparison.legs.map((l) => REGION_PLACE[l.marketKey] ?? l.marketKey);

  if (comparison.mode === "single-market") {
    const place = places[0] ?? "";
    return {
      cardLine: `${place}에서 확인한 가격이에요`,
      headline: `${place}에서 확인한 가격이에요`,
      diffLine: null,
      disclosure: DISCLOSURE,
    };
  }

  const headline = `${places.join("·")}에서 확인한 가격이에요`;

  if (comparison.mode === "comparable-unverified") {
    return {
      cardLine: `${places.join("·")} 가격 확인됨`,
      headline,
      diffLine: null,
      disclosure: DISCLOSURE,
    };
  }

  // comparable: only mode where a difference is stated - still a neutral
  // "차이", never "절약"/"저렴해요".
  const winner = comparison.legs.find((l) => l.isWinner)!;
  const diffLine = winner.savingsVsHighestKrw > 0 ? `확인한 가격 기준 약 ${formatKrw(winner.savingsVsHighestKrw)} 차이` : null;
  return {
    cardLine: diffLine ?? "가격 차이가 거의 없어요",
    headline,
    diffLine,
    disclosure: DISCLOSURE,
  };
}
