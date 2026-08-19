import type { ComparisonResult } from "@core/services/comparisonService";
import { formatKrw } from "../../lib/format";

/**
 * Turns an ALREADY-COMPUTED ComparisonResult (from comparisonService.compareVariant,
 * never re-derived here) into the verdict copy the brief asks for. This file
 * only picks words for numbers that already exist - it never compares prices
 * or decides a winner itself.
 */

export type ConclusionTone = "kr" | "jp" | "intl" | "single" | "no-data" | "close";

export interface Conclusion {
  tone: ConclusionTone;
  /** one-line form for list rows, e.g. "일본에서 사면 131,803원 절약" */
  cardLine: string;
  /** full-sentence form for the product page hero, e.g. "일본에서 사는 게 가장 저렴해요" */
  headline: string;
  /** e.g. "131,803원 절약" - null when there's nothing to compare */
  savingsLine: string | null;
}

const CLOSE_ENOUGH_RATIO = 0.02; // under 2% apart reads as "no real difference"

const REGION_PLACE: Record<string, string> = {
  KR: "한국",
  JP: "일본",
  INTL: "해외직구",
};

export function buildConclusion(
  comparison: ComparisonResult,
  regionOf: (sourceId: string) => string | undefined,
): Conclusion {
  if (comparison.mode === "no-data") {
    return {
      tone: "no-data",
      cardLine: "가격 정보 없음",
      headline: "아직 비교할 가격 정보가 없어요",
      savingsLine: null,
    };
  }

  if (comparison.mode === "single") {
    return {
      tone: "single",
      cardLine: "현재 비교 가능한 판매처가 1곳이에요",
      headline: "현재 비교 가능한 판매처가 1곳이에요",
      savingsLine: null,
    };
  }

  const winner = comparison.legs.find((l) => l.isWinner) ?? comparison.legs[0];
  const highest = winner.krwPrice + winner.savingsVsHighestKrw;
  const ratio = highest > 0 ? winner.savingsVsHighestKrw / highest : 0;

  if (ratio < CLOSE_ENOUGH_RATIO) {
    return {
      tone: "close",
      cardLine: "가격 차이가 거의 없어요",
      headline: "가격 차이가 거의 없어요",
      savingsLine: winner.savingsVsHighestKrw > 0 ? `${formatKrw(winner.savingsVsHighestKrw)} 차이` : null,
    };
  }

  const region = regionOf(winner.sourceId);
  const place = (region && REGION_PLACE[region]) || "이곳";
  const savingsLine = `${formatKrw(winner.savingsVsHighestKrw)} 절약`;

  return {
    tone: region === "KR" ? "kr" : region === "JP" ? "jp" : "intl",
    cardLine: region === "KR" ? `한국에서 사는 게 ${formatKrw(winner.savingsVsHighestKrw)} 저렴해요` : `${place}에서 사면 ${formatKrw(winner.savingsVsHighestKrw)} 절약`,
    headline: `${place}에서 사는 게 가장 저렴해요`,
    savingsLine,
  };
}
