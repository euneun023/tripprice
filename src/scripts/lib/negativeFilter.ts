/**
 * Phase 1-A/1-B high-confidence negative filter (읽기 전용, 분석 전용).
 *
 * Phase 0 baseline(commit a873520, src/scripts/candidate-data/matching-baseline.json)의
 * "obvious reject" 49건 중, 이번 단계에서 실제로 자동 reject 대상으로 삼는 것은
 * accessory(11) + wrong_category(22) + bundle_condition_mismatch(9) = 42건뿐이다.
 * variant_mismatch(7)는 지시대로 이번 phase에서 다루지 않는다 - 세대/모델 번호
 * 비교는 키워드 매칭으로는 안전하게 판별할 수 없다(예: "Axiom i3" vs "i3+",
 * "OM-5" vs "OM-5 Mark II"는 문자열만으로 구분 불가).
 *
 * 설계 원칙(false positive=0 최우선):
 *  - USED/CONDITION 판정은 中古/訳あり/중고 같은, review-proposal.md 문서들이
 *    이미 "제외 대상"으로 명시한 무조건 안전한 토큰만 사용한다. 어떤
 *    documented exact 후보의 실제 채택 listing도 이 토큰을 포함하지 않는다
 *    (문서마다 "中古 표기 리스팅은 제외"가 채택 기준으로 명시돼 있음).
 *  - WRONG_CATEGORY 판정은 review-proposal.md들이 실제로 관찰/기록한 노이즈
 *    패턴(전자책/음반/화장품/식품/자동차용품/악기·오디오/PC주변기기/의류/
 *    반려동물/캠핑·낚시 등, 우리 12개 productType 어디에도 속하지 않는
 *    카테고리)에서 가져온 키워드만 쓴다.
 *  - ACCESSORY 판정은 productType별로 분리한다 - 같은 단어(예: "필터")가
 *    camera_lens에서는 허용된 번들(문서: "렌즈 + 필터 1개... 허용")이지만
 *    dive_computer/regulator에서는 명백한 부속품 오매치이므로, 전역
 *    키워드가 아니라 productType별 목록 + "positive body marker"
 *    가드(바디/본체를 가리키는 표현이 함께 있으면 accessory 판정을
 *    보류)로 제한한다. 이 가드는 방향성이 안전하다 - 최악의 경우
 *    recall만 낮아지고(놓치는 accessory), false positive를 만들지 않는다.
 *  - 모든 목록은 Phase 0 baseline의 실제 listing 텍스트로 검증
 *    (evaluate-negative-filter.ts) - exact/ambiguous/variant_mismatch
 *    후보를 잘못 걸러내면 안 된다.
 *
 * Phase 1-B: accessory recall 개선. 1-A의 productType별 positiveBodyMarker
 * 가드는 "원 제품명이 함께 있으면 accessory 판정을 보류"하는데, 실제
 * accessory listing은 거의 항상 원 제품명을 포함한다(예: "SCUBAPRO
 * ジェットフィン用ストラップ"는 "フィン"을 포함해 fins 가드에 막혔다) - 이
 * 가드가 recall을 지나치게 깎고 있었다. 해결책은 productType 무관하게
 * 적용되는 별도 규칙 하나: "호환성 문맥 마커"(전용/호환/교체용/for/
 * compatible with/replacement/fits)와 "물리적 부착형 accessory 명사"
 * (strap/hood/filter/cap/case/cover/adapter/band/belt/pouch/grip/ring)가
 * **함께** 나타나면, positiveBodyMarker 가드를 무시하고 accessory로
 * 확정한다 - 원 제품명이 있어도 "이건 그 제품용 부속품"이라는 명시적
 * 문맥이 있으면 명백하기 때문이다(지시사항: "원 제품명이 포함되어 있어도
 * accessory 표현이 명확하면 reject").
 *
 * 마커 선택 기준(단순 키워드 하나만으로 reject하지 않기 위한 안전장치):
 *  - 일본어 "用"(=~용) 단독은 채택하지 않았다 - "ミラーレス一眼カメラ用"처럼
 *    렌즈/바디 자신의 마운트 호환성을 설명하는 매우 흔한 표현이라(실제
 *    Sony FE 24-70mm GM II 등 여러 exact listing에서 확인) 이것만으로는
 *    accessory 신호가 아니다. "対応"도 같은 이유로 제외("Eマウント対応"도
 *    렌즈 자신을 묘사하는 표현).
 *  - 대신 "専用"/"交換用"/"互換"(JP), "호환"/"교체용"/"전용"(KR), "for "/
 *    "compatible with"/"replacement"/"fits "(EN)만 마커로 쓴다 - 전부
 *    "다른 것에 붙는 부속품"이라는 의미가 강한 표현이고, accessory
 *    명사와 함께 나타나야만 발동하므로(둘 다 필요) 단어 하나만으로
 *    판정하지 않는다.
 *  - accessory 명사 목록에는 배터리/충전기를 넣지 않았다(1-A에서 확인된
 *    실제 충돌: Nikon Z8 exact listing이 "予備バッテリー1個プレゼント"
 *    번들을 포함) - 물리적 부착 부품(스트랩/후드/필터/캡/케이스/커버/
 *    어댑터/밴드/벨트/파우치/그립/링)만 사용한다.
 *
 * Phase 1-E: 남은 obvious reject 36건(accessory 8/wrong_category 13/
 * bundle_condition_mismatch 8/variant_mismatch 7) 중, baseline 전체를
 * 대조해 실제로 "반복되는 패턴"만 최소 추가했다(단일 후보에서만 한 번
 * 나타나는 표현은 일부러 추가하지 않았다 - "단순 substring 남발 금지"):
 *  - "게이밍 헤드셋": 1-B에서 이미 등록한 게이밍 마우스/키보드와 같은
 *    PC·게이밍 주변기기 노이즈 카테고리의 연장.
 *  - "DJI RS": 1-B에서 이미 등록한 "짐벌" 카테고리의 연장 - DJI RS 시리즈
 *    제품명이 "짐벌"이라는 단어 없이 단독으로 등장하는 경우.
 *  - "컬러필름"/"현상소": FUJIFILM X-Pro3·GFX50S II 두 candidate에
 *    문자 그대로 동일한 문자열("후지필름 컬러필름 수퍼리아 C200...
 *    현상소...")이 반복 등장 - Coupang의 "채움 노이즈" 패턴(Phase 0
 *    문서에서 이미 확인된 것과 동일한 현상).
 *  - camera productType 전용 "호환배터리": FUJIFILM X-Pro3·GFX50S II
 *    양쪽에 "NP-W235 호환배터리"류 표현이 반복 등장. "호환"이 명시된
 *    서드파티 배터리 단품 판매 표현이라 "予備バッテリー1個プレゼント"
 *    (정품 바디 구매 시 사은품으로 배터리 증정)와는 문형이 달라
 *    충돌하지 않는다 - camera productType에만 한정 적용.
 *  - camera productType 전용 "크로스바디"/"바디 전면 커버"/"접사링":
 *    keyword 자체가 positiveBodyMarker("바디")를 포함하는 합성어라
 *    자기모순 우회 규칙이 이미 적용된다(위 참고) - "크로스바디"(가방
 *    용어, 카메라 "바디"를 절대 의미하지 않음)와 "바디 전면 커버"는
 *    keyword 자신이 이미 "바디"를 포함해 안전하다. "접사링"은 기존
 *    "接写リング"(일본어)의 한국어 표기만 추가한 것 - 새 카테고리가
 *    아니라 기존 keyword의 언어 변형 보완이다.
 *  - camera productType 전용 "파우치": 1-B의 COMPAT_ACCESSORY_NOUNS에
 *    이미 있던(마커 필요) 명사를 camera에 한해 마커 없이도 직접
 *    매치하도록 확장 - GFX50S II의 "카메라 렌즈 파우치 케이스백"류
 *    표현이 마커 없이(bare "用"만 있음) 등장해 기존 규칙으로는
 *    못 잡았다.
 *  - variant_mismatch(7건)는 이번에도 다루지 않았다 - 세대/모델
 *    비교이지 accessory/wrong_category/condition 문제가 아니라서
 *    lexical 규칙으로는 원천적으로 해결할 수 없다(이번 phase에서도
 *    baseline 전체 재확인 결과 동일한 결론).
 */

export type NegativeReason = "used_condition" | "wrong_category" | "accessory";

export interface NegativeFilterResult {
  negative: boolean;
  reason: NegativeReason | null;
  matchedKeyword: string | null;
}

// review-proposal.md 문서들이 채택 기준으로 명시한, 방향성이 확실한 토큰만.
const USED_CONDITION_KEYWORDS = ["中古", "訳あり", "중고", "리퍼비시", "refurbished", "renewed品"];

// 문서에서 실제 관찰된 cross-domain 노이즈. 우리 12개 productType(camera,
// camera_lens, earbuds, headphones, smartwatch, dive_computer, diving_mask,
// fins, wetsuit, dive_light, bcd, regulator) 어디와도 무관한 카테고리만.
const WRONG_CATEGORY_KEYWORDS = [
  // 도서/전자책/음반
  "電子書籍", "전자책", "楽天Kobo", "楽天ブックス",
  // 화장품/뷰티
  "스킨케어", "토너로션", "선스틱", "페이스워시", "클렌징", "에센셜 오일", "히알루론산", "아크디스",
  // 식품/영양제/생활용품
  "프로틴 밸런스", "아메리카노", "천연펄프", "구이세트", "BCAA", "NAD+", "NMN 고순도", "딜피클", "액상세제", "물티슈", "섬유유연제", "고양이 건식사료",
  // 자동차용품
  "차량용", "자동차 하이브리드", "헤드레스트", "카매트", "블랙박스", "GPS 속도계", "HUD",
  // 악기/오디오(다이빙/카메라 장비 아님)
  "일렉기타", "통기타", "턴테이블", "오디오믹서", "오디오 앰프", "이펙터", "기타 앰프",
  // PC주변기기
  "외장SSD", "게이밍키보드", "게이밍 마우스", "게이밍 헤드셋", "무선 마우스", "마스터키보드", "키보드",
  // 카메라 짐벌 제품군("짐벌"이라는 단어 없이 시리즈명만 등장하는 경우)
  "DJI RS",
  // 사진 필름/현상 서비스(카메라 "본체"가 아니라 소모품·서비스)
  "컬러필름", "현상소",
  // 의류/잡화
  "티셔츠", "청바지", "슬리퍼", "팔찌", "백팩",
  // 캠핑/낚시/스포츠 무관종목
  "낚싯줄", "낚시줄", "카본라인", "낚시대", "배드민턴 라켓", "보드게임",
  // 이어폰/헤드폰 소모품이 엉뚱한 카테고리(카메라 등) 검색에 섞여 들어온 경우
  "이어패드",
  // 자동차/전자부품/기타 잡화(review-proposal.md에서 실제 관찰된 노이즈)
  "위치추적기", "릴레이", "아두이노", "짐벌", "휠밸런서", "조미료", "시즈닝",
];

// Phase 1-B: productType 무관 "호환성 문맥 마커" - 이것만으로는 절대 reject
// 하지 않는다(예: bare "用"/"対応"은 렌즈/바디 자신의 마운트 설명에도 흔히
// 쓰여 위험하므로 의도적으로 제외했다). 반드시 COMPAT_ACCESSORY_NOUNS와
// 함께 나타나야 발동한다.
const COMPAT_MARKERS = ["専用", "交換用", "互換", "호환", "교체용", "전용", " for ", "compatible with", "replacement", "fits "];

// Phase 1-B: 물리적으로 "부착"되는 부속품만(본체/렌즈 자체를 가리키는 단어는
// 절대 넣지 않는다). 배터리/충전기는 1-A에서 확인된 실제 충돌(Nikon Z8
// exact listing의 예비배터리 번들) 때문에 의도적으로 제외했다. "ring"/"링"/
// "リング"는 제외했다 - 실제 exact 후보(JBL Tour One M3)의 "ノイズ
// キャンセリング"(노이즈 캔슬링)라는 지극히 흔한 단어 안에 "リング"가
// 부분 문자열로 들어있어 false reject를 유발함을 확인했다(영어 "ring"도
// during/wearing/hearing/engineering 등 흔한 단어의 부분 문자열이라 동일
// 위험).
const COMPAT_ACCESSORY_NOUNS = [
  "스트랩", "후드", "필터", "케이스", "커버", "어댑터", "밴드", "벨트", "파우치", "그립",
  "ストラップ", "フード", "フィルター", "キャップ", "ケース", "カバー", "アダプター", "バンド", "ベルト", "ポーチ", "グリップ",
  "strap", "hood", "filter", "case", "cover", "adapter", "band", "belt", "pouch", "grip",
  // 화면/액정 보호 필름류 - "필름" 단독은 브랜드명 "후지필름(Fujifilm)"과 겹쳐
  // 위험하므로 쓰지 않고, "보호필름"/"保護フィルム"처럼 브랜드명과 절대
  // 겹치지 않는 합성어만 사용한다.
  "보호필름", "保護フィルム", "프로텍터", "protector",
  // 트랜스미터/케이블류 물리 부속품(본체 자체를 가리키는 단어는 아님)
  "탱크 모듈", "タンクモジュール", "케이블", "ケーブル", "cable",
];

interface ProductTypeAccessoryConfig {
  keywords: string[];
  /** 이 중 하나라도 있으면 accessory 판정을 보류(false positive 방지용 가드). */
  positiveBodyMarkers: string[];
}

const ACCESSORY_CONFIG: Partial<Record<string, ProductTypeAccessoryConfig>> = {
  camera: {
    keywords: [
      "液晶保護フィルム", "保護フィルム", "강화유리", "액정보호필름", "카메라케이스", "シリコンカメラケース",
      "ボディケース", "ボディキャップ", "ボディカバー", "ボディマウント保護キャップ", "본체 커버", "렌즈 백커버",
      "바디캡", "렌즈캡", "카메라 스킨", "데칼 스킨", "接写リング", "접사링", "액세서리", "렌즈 키트", "レンズキット",
      // Phase 1-E: "호환"이 명시된 서드파티 배터리 단품(정품 바디 구매 시
      // 사은품으로 딸려오는 予備バッテリー 번들과는 다른 문형이라 안전).
      "호환배터리",
      // keyword 자체가 "바디"를 포함하는 합성어라 자기모순 우회가 적용됨.
      "크로스바디", "바디 전면 커버",
      // 렌즈/카메라용 파우치·케이스백(이미 COMPAT_ACCESSORY_NOUNS에 있는
      // 명사를 camera productType에 한해 마커 없이도 직접 매치하도록 확장).
      "파우치",
    ],
    positiveBodyMarkers: ["ボディ", "바디", "BODY", "本体"],
  },
  camera_lens: {
    // "필터"/"후드"는 문서에서 허용된 번들 사례가 있어 제외(예: "렌즈+필터 번들
    // 허용"). "배터리"는 렌즈 자체에 배터리가 딸려오는 정상 구성이 이
    // dataset/문서 어디에도 없어(바디와 달리 렌즈는 배터리를 쓰지 않음)
    // camera_lens에 한해 안전하게 사용 가능(camera productType에는 미적용 -
    // 그쪽은 실제 exact 후보에 "予備バッテリー1個プレゼント" 번들이 있어 위험).
    keywords: ["삼각대 풋", "三脚座", "카메라 스킨", "액정보호필름", "液晶保護フィルム", "レンズキャップ", "렌즈캡", "배터리", "충전기"],
    positiveBodyMarkers: ["mm F", "mmF", "focal"],
  },
  bcd: {
    keywords: ["ウエイトポケット", "웨이트포켓", "웨이트루프", "アクセサリーバンジー", "バンジーセット", "カラーキット", "スチール製品", "인플레이터, 호스", "탱크 어댑터", "Single Tank Adapter"],
    positiveBodyMarkers: ["BCD", "부력조절기", "ジャケット", "ハーネス", "Wing", "ウイング"],
  },
  regulator: {
    keywords: ["Octopus by", "옥토퍼스 단품", "오리 옥토퍼스", "アクセサリーバンジー", "중압 호스"],
    positiveBodyMarkers: ["レギュレーター", "레귤레이터", "호흡기", "Regulator"],
  },
  fins: {
    keywords: ["交換用ストラップ", "교체용 스트랩", "스케그스", "부츠 포함"],
    positiveBodyMarkers: ["フィン", "핀", "오리발", "Fin"],
  },
  dive_computer: {
    keywords: [
      "画面保護フィルム", "保護フィルム", "화면보호필름", "액정보호필름", "보호 필름", "USBケーブル", "충전케이블", "USB충전", "충전 케이블", "충전 어댑터",
      "USB充電", "充電器", "充電アダプタ", "ケーブルコード", "ケーブル",
      "Tank POD", "LED 탱크 모듈", "LEDタンクモジュール", "ノーズカバー", "交換 バンド", "腕時計バンド", "손목밴드", "밴드 커버", "커버용", "보호대",
      "ストラップ", "스트랩", "エクステンションストラップ", "Strap Kit", "보호대 쉘 범퍼",
    ],
    positiveBodyMarkers: ["ダイブコンピューター", "ダイビングコンピューター", "コンピュータ", "다이브 컴퓨터", "다이빙 컴퓨터", "Dive Computer"],
  },
  dive_light: {
    keywords: ["ボールジョイントアダプター", "볼 조인트 어댑터", "일회용 배터리", "충전기 (타사호환)"],
    positiveBodyMarkers: ["ダイビングライト", "다이빙 라이트", "다이빙랜턴", "Dive Light", "Torch"],
  },
};

function includesAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (haystack.includes(n)) return n;
  }
  return null;
}

/**
 * 개별 listing 텍스트(rakuten itemName 또는 coupang productName) 하나를
 * 분류한다. matching 로직(evaluate-candidates.ts)은 건드리지 않는다 -
 * 이 함수는 순수 텍스트 분류 유틸이며, 호출 여부는 이 phase의 evaluate
 * 스크립트에서만 결정한다.
 */
export function classifyListingText(text: string, productType: string): NegativeFilterResult {
  const usedMatch = includesAny(text, USED_CONDITION_KEYWORDS);
  if (usedMatch) {
    return { negative: true, reason: "used_condition", matchedKeyword: usedMatch };
  }

  const wrongCategoryMatch = includesAny(text, WRONG_CATEGORY_KEYWORDS);
  if (wrongCategoryMatch) {
    return { negative: true, reason: "wrong_category", matchedKeyword: wrongCategoryMatch };
  }

  // Phase 1-B: 호환성 문맥(마커) + 부착형 accessory 명사가 함께 있으면
  // productType의 positiveBodyMarker 가드를 무시하고 accessory로 확정한다.
  // 영문 마커/명사만 대소문자 무시(한국어/일본어는 대소문자 개념이 없음).
  const lowerText = text.toLowerCase();
  const compatMarker = COMPAT_MARKERS.find((m) => (/[a-z ]/i.test(m) ? lowerText.includes(m.toLowerCase()) : text.includes(m)));
  if (compatMarker) {
    const compatNoun = COMPAT_ACCESSORY_NOUNS.find((n) => (/[a-z]/i.test(n) ? lowerText.includes(n.toLowerCase()) : text.includes(n)));
    if (compatNoun) {
      return { negative: true, reason: "accessory", matchedKeyword: `${compatMarker.trim()}+${compatNoun}` };
    }
  }

  const config = ACCESSORY_CONFIG[productType];
  if (config) {
    for (const keyword of config.keywords) {
      if (!text.includes(keyword)) continue;
      // 가드는 "keyword 자체가 marker를 포함하지 않는 경우"에만 적용한다 -
      // 예: "ボディケース"는 accessory keyword이면서 동시에 marker "ボディ"를
      // 포함하므로, marker 존재만으로 무조건 통과시키면 이 keyword가 절대
      // 발동할 수 없는 자기모순이 생긴다. keyword 자신이 이미 marker를
      // 포함하는 경우는 marker가 keyword 바깥에 "따로" 있을 때만 보류한다.
      const markerOutsideKeyword = config.positiveBodyMarkers.some((m) => !keyword.includes(m) && text.includes(m));
      if (!markerOutsideKeyword) {
        return { negative: true, reason: "accessory", matchedKeyword: keyword };
      }
    }
  }

  return { negative: false, reason: null, matchedKeyword: null };
}
