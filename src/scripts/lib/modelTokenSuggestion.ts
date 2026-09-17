/**
 * Phase 1-D: model-number suggestion annotation (읽기 전용, 비권위적,
 * evaluator/selectedIndex 자동결정과 완전히 분리됨).
 *
 * Gate 평가 결과(src/scripts/measure-model-token-suggestion.ts로 429 baseline
 * 전체 재현 가능):
 *
 *  - Rakuten unique match(5건): 실제 선택된 listing과 일치 2/3(66.7%,
 *    ground truth 있는 건 기준). 나머지 1건(Tamron 12-20mm F2.8)은 진짜
 *    오매치였다 - modelSkuHint "A084"가 token 경계상 니콘Z 마운트
 *    listing(Model A084)에 매치됐지만, 실제 선택된 건 소니E 마운트
 *    listing(Model A084S)이었다. **같은 productType 안에서도 마운트/구성
 *    접미사가 없는 base code가 다른 variant listing에 우연히 등장할 수
 *    있다**는 뜻 - "exact" 카테고리 candidate에서 실제로 발생한 사례.
 *  - Coupang unique match(15건): ground truth 있는 6건 중 5건 일치
 *    (83.3%). 하지만 ground truth가 없는 나머지 9건 중 6건(전체의 40%)은
 *    "(모델코드) 호환용" 형태로 모델코드를 언급하는 **액세서리
 *    listing**이었다(액정보호필름/카메라 케이스/배터리 케이스 등) - 실제
 *    상품이 없어서 no_match 처리된 candidate에서 이 액세서리가 유일하게
 *    modelSkuHint를 포함하는 listing이었던 것. negativeFilter.ts가 이 중
 *    절반 정도만 이미 걸러낸다(나머지는 "강화글라스"/"카메라 바디 케이스"
 *    등 현재 키워드 목록에 없는 표현이라 통과).
 *
 * 결론: "이 index가 정답이다"라고 특정 listing을 가리키는 방식은 이번
 * 조사에서 실측된 위험(마운트/구성 오매치, 액세서리 호환표기 오매치) 때문에
 * Gate를 통과하지 못했다고 판단했다 - unique match(=1)라고 해서 안전하지
 * 않다는 게 이번 phase의 핵심 발견이다. 그래서 이 모듈은 **어떤 경우에도
 * 특정 listing/index를 추천하지 않는다** - "이 source에 modelSkuHint
 * token이 N건 매치됐다"는 사실 정보만 제공한다(지시사항의 multi-match
 * fallback 표시 방식을 unique match에도 동일하게 적용한 것). 이 형태는
 * 정의상 틀릴 수 없다(단순 카운트라 "오매치"라는 개념 자체가 성립하지
 * 않는다) - false suggestion=0을 구조적으로 보장한다.
 *
 * 사용 금지 사항(코드로 강제하지는 않지만 설계 의도):
 *  - 이 결과로 rakutenSelectedIndex/coupangSelectedIndex를 채우지 않는다.
 *  - evaluator의 reviewStatus/matchConfidence 판정에 관여하지 않는다.
 *  - review-proposal 문서에 "추천 index"로 표기하지 않는다 - "N건 매치"
 *    문구로만 표기한다.
 */

import { countModelTokenMatches } from "./identifierMatch";

export type ModelTokenSuggestion = { hasMatch: false } | { hasMatch: true; listingCount: number };

/**
 * texts(한 source의 listing 텍스트 목록)에서 modelCode가 토큰으로 몇 건
 * 매치되는지만 센다. 몇 번째 listing인지는 절대 알려주지 않는다 - 그 정보
 * 자체가 "이걸 골라라"는 암묵적 추천이 되기 때문이다.
 */
export function buildModelTokenSuggestion(texts: string[], modelCode: string | null | undefined): ModelTokenSuggestion {
  if (!modelCode) return { hasMatch: false };
  const listingCount = countModelTokenMatches(texts, modelCode);
  if (listingCount === 0) return { hasMatch: false };
  return { hasMatch: true, listingCount };
}

/**
 * review-proposal 문서용 비권위적 주석 한 줄. 특정 listing/index를 절대
 * 언급하지 않는다 - "N건 매치"만 말한다(unique match=1건도 동일 취급,
 * Gate 평가 결과 참고).
 */
export function formatModelTokenSuggestionLine(sourceLabel: string, modelCode: string, suggestion: ModelTokenSuggestion): string | null {
  if (!suggestion.hasMatch) return null;
  return `${sourceLabel}: modelSkuHint("${modelCode}") token이 listing ${suggestion.listingCount}건에서 발견됨 - 참고 정보일 뿐 특정 listing 추천 아님, selectedIndex 자동 설정 없음, evaluator 판정에 영향 없음.`;
}
