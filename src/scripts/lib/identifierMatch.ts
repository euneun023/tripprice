/**
 * Phase 1-C structured identifier/model-number benchmark signal (읽기 전용,
 * 분석 전용 - evaluator/selectedIndex 자동결정에는 연결하지 않았다).
 *
 * 배경(Phase 1-C 1단계 coverage 조사, src/scripts/analyze-identifier-coverage.ts):
 *  - JAN/UPC/EAN: candidate-data 어디에도 구조화된 필드가 없다. listing 텍스트
 *    안에 우연히 12~13자리 숫자가 들어있는 경우가 429건 중 5건뿐이고 실제
 *    바코드인지 가격/기타 숫자인지도 구분 불가 - 이 phase에서는 구현하지
 *    않는다(지시사항: "coverage가 너무 낮으면 억지 구현하지 말 것").
 *  - modelSkuHint(제조사 model number, 예: "ILCE-1M2", "SEL2470GM2",
 *    "BC0103B"): 429건 중 70건(16.3%)에 값이 있고, 그중 49건이 기존
 *    evaluate-candidates.ts의 isSkuLikeModelSku() 휴리스틱을 통과한다
 *    (mm 단위 초점거리 표기 등은 이미 그 함수가 걸러냄 - 여기서 재구현하지
 *    않고 그대로 재사용한다).
 *  - 이 49건에 대해 실제 listing 텍스트에 token 경계 기준으로 매치해보면,
 *    exact 카테고리에서 사람이 실제로 선택한 listing과 94.6%(Rakuten,
 *    35/37)·83.3%(Coupang, 25/30) 일치한다 - "이 코드가 들어있는 listing이
 *    correct product다"라는 신호로서 실사용 가능한 정밀도.
 *  - ambiguous 카테고리에서 modelSkuHint가 있는 3건(Panasonic LUMIX S5II,
 *    Master & Dynamic MW75, TUSA Liberator)을 개별 확인한 결과 false
 *    positive가 0건이었다 - 특히 LUMIX S5II는 "DC-S5M2"가 실제로는 항상
 *    "DC-S5M2W/K/XW" 같은 키트 접미사와 함께만 등장해서(순정 바디 단독
 *    listing이 아예 없음) token 경계 매칭이 자동으로 전부 no-match 처리한
 *    사례 - 접미사가 다른 SKU는 별개 코드로 취급되는 것이 정확히 우리가
 *    원하는 안전한 동작이다.
 *
 * 설계: "multiple listings matching" 자체는 위험 신호가 아니다 - 같은
 * 제품을 여러 판매자가 파는 정상적인 경우가 대부분이다. 위험한 건
 * "다른 제품인데 매치되는 것"(false positive)이지 "여러 listing이
 * 매치되는 것"이 아니다. 그래서 이 모듈은 "unique match" 여부를 판정하지
 * 않고, 순수하게 "이 listing 텍스트에 이 코드가 토큰으로 들어있는가"만
 * 답한다 - 그 이상의 선택/집계 로직(어떤 listing을 고를지)은 이 phase의
 * 범위 밖이다.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * modelCode가 text 안에 "토큰"으로 존재하는지 확인한다 - 단순 substring이
 * 아니라 앞뒤가 영숫자가 아닐 때만 경계로 인정한다(지시사항: substring
 * fuzzy match 금지). 대소문자는 무시한다(Rakuten/Coupang 표기가 종종
 * 다름, 예: "SEL2470GM2" vs "sel2470gm2"는 실무상 같은 코드).
 *
 * 접미사가 붙은 변형 코드(예: modelCode="DC-S5M2"인데 text에는
 * "DC-S5M2W"만 있는 경우)는 의도적으로 매치시키지 않는다 - 접미사 한 글자
 * 차이가 실제로 다른 SKU/구성(바디 단독 vs 키트)을 의미하는 경우가
 * 이번 phase 조사에서 실제로 확인됐다(Panasonic LUMIX S5II).
 */
export function matchesModelToken(text: string, modelCode: string): boolean {
  if (!modelCode) return false;
  const escaped = escapeRegExp(modelCode);
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
  return pattern.test(text);
}

/** texts 중 modelCode를 토큰으로 포함하는 개수. 집계/보고용 편의 함수. */
export function countModelTokenMatches(texts: string[], modelCode: string): number {
  return texts.filter((t) => matchesModelToken(t, modelCode)).length;
}
