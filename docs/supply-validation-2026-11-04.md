# 공급 구조 검증 — 비교 가능한 상품 수를 늘릴 수 있는가 (2026-11-04)

목적: 등록 상품 수가 아니라 **한국·일본에서 실제로 비교 가능한 상품 수**를 지속적으로 늘릴 수 있는
공급 구조가 있는지 검증한다. `docs/data-sources-research-2026-11.md`(11-03)에서 이미 확인한 항목은
반복하지 않고, 이번에 **추가로 확인된 것 / 정정할 것 / 여전히 모르는 것**만 적는다.

이번 작업에서 **외부 API 호출, 대량 수집, 계정 생성, Secret 조회는 하지 않았다.**
이 문서의 모든 "실측"은 저장소 코드·데이터·합성 데이터에 대한 것이다.

---

## 0. 증거 등급 (이전 조사와 동일 + 이번 추가)

| 등급 | 의미 |
|---|---|
| **A** | 이 저장소의 코드가 실제 호출로 동작함이 코드·주석에 기록된 것 (과거 실행) |
| **B** | 공식 도메인 문서의 **발췌**. 원문 전체·약관 조항 원문은 읽지 못함 |
| **C** | 2차 정보(블로그·SDK README 등). 판정 근거로 쓰지 않음 |
| **U** | UNKNOWN |
| **R** | 이번 세션에서 이 저장소의 코드/데이터로 **직접 실행해 측정**한 것 (합성·오프라인) |

**이번 세션의 열람 제약 (2026-11-04)**: `developer.yahoo.co.jp`, `webservice.rakuten.co.jp`,
`openapi.11st.co.kr` 세 호스트가 세션 네트워크 정책 때문에 DNS 단계에서 실패했다(WebFetch).
따라서 **약관 원문을 직접 읽은 공급처는 0곳**이다. 검색 발췌만으로 "상업적 이용 가능/불가"를
판정하지 않았다. 이를 해소하려면 세션 허용 도메인에 위 호스트를 추가해야 한다(§8).

가입 가능 / API 접근 가능 / 상업적 공개 가능 / 저장 가능 / 제휴 정산 가능은 **각각 별도 열**로 기록한다.

---

## 1. 공급처별 검증표

`✔A`=코드로 동작 확인, `✔B`=문서 발췌, `?`=UNKNOWN, `✘`=불가 확인

### 일본

| 항목 | Rakuten Ichiba Item Search | Yahoo Shopping v3 | ValueCommerce 상품 API | Amazon JP Creators API |
|---|---|---|---|---|
| **판매자별 가격** | ✔A `itemPrice` (샵 단위 1건=1리스팅) | ✔B 상점 단위 상품(hits). 응답 필드명은 **미확인**(§5) | ? 현행 명세 미확인 | ✔B OffersV2 가격(Offers는 폐지). 판매자 단위 여부 **미확인** |
| **판매처 식별** | ✔A `shopName`, `shopCode` | ✔B 상점(seller) 개념 존재 · 필드명 미확인 | ? | ? |
| **구매 URL** | ✔A `itemUrl` | ✔B `url` 계열 · 미확인 | ? | ? (제휴 링크 형태) |
| **재고** | ✔A `availability` 1/0 | ✔B `inStock` 계열 · 미확인 | ? | ✔B availability(OffersV2) · 미확인 |
| **검색 범위** | 키워드/shopCode/genreId/itemCode | ✔B 키워드·**JAN**·ジャンル·ブランド·ストア (2026-02 파라미터 갱신) | ? (2007년 "75개 EC, 약 1,200만 점"은 **C·낡음**) | 키워드/ASIN |
| **식별자** | ✘ JAN·型番 필드 없음 | ✔B JAN 검색. 응답에 JAN 포함 여부 미확인 | ? | ASIN 중심 · JAN/型番 노출 미확인 |
| **한국 거주 개인 가입** | ✔A 가능(현재 가동) | **?** JP ID 개설이 관문. 공식 헬프 "해외 번호 SMS 불가"(B, 11-03) | ? 파트너 등록 필요(C·2010 보도) | **?** 승인된 JP Associates 계정 필요(B) |
| **API 접근 조건** | 키 보유 시 가능 | appid(JP ID 선행) | 파트너 등록 | **판매 실적**: Creators 경유 PA 접근에 30일 10건 보고(B 발췌, 2차 혼재) |
| **상업적 가격비교 허용** | **?** 제3조 제휴링크 조건(B 11-03), **제10조 원문 미확인** | **?** 기본 "비상용"·법인은 문의(B 11-03). 원문 미확인 | ? | ? |
| **저장·재표시** | **?** 제6조 지재권 귀속·제7조 빈도 제한 가능(B 11-03), 제10조 미확인 | ? | ? | **?** 아래 "충돌" 참조 |
| **호출 제한·비용** | 429 관측(A) · 1 QPS 등록 · 무료 | 분당 30회(B 11-03) · 무료 | ? | ? |
| **한국에서 제휴 정산** | ✘B 일본 국내 계좌만(11-03) | ?(ValueCommerce·일본 금융기관 전제 추정) | ? | ? (기프트카드 보고는 C) |

**충돌 (Amazon 캐싱)**: 11-03 문서는 "비이미지 24시간 캐싱 제한"을 제외 사유로 들었지만, 이번 검색에서 그 문구는
**2차 자료의 해석**(C)이었고, 공식 Creators API best-practices 발췌(B)는 "응답 필드의 캐싱 방식은 자유, 단
고객 정보 캐싱은 약관 위반"이라고 한다. **두 출처가 충돌하므로 24시간 제한을 사실로 쓰지 않는다. U.**
(PA-API 폐지일은 Amazon 문서 발췌 기준 2026-05-15, B.)

### 한국

| 항목 | Coupang Partners | 11번가 Open API | 제휴 상품 피드(링크프라이스 등) |
|---|---|---|---|
| **판매자별 가격** | ✘ 판매자 구분 없음. 결과 1건 = 쿠팡 내 리스팅 1건(A) | ✔B(11-03) 오픈마켓이라 판매자가 응답에 포함 · **이번 세션 재확인 불가** | ? 머천트별 "인기/최저가 subset"(B 11-03) |
| **판매처 식별** | 쿠팡(마켓) 수준만 | ✔B 판매자 필드 · 미확인 | 머천트 단위 |
| **구매 URL** | ✔A `productUrl` | ✔B 상세 URL | ✔(제휴 링크) |
| **재고** | ✘ 필드 없음 | ? | ? |
| **검색 범위** | 키워드만, **최대 10건**(코드 상수, A) | 키워드, pageSize 최대 200(B 11-03) | 머천트 제공 범위 |
| **식별자** | productId만 | 상품코드만 | ? |
| **가입** | ✔A 승인·가동 | ✔B 셀러 전환 불필요 | 가입 필요 · 조건 ? |
| **상업적 허용·저장·재표시** | **?** 약관 비공개(문서가 로그인 뒤) | **?** 이번 검색에서 약관 정보 0건 | ? |
| **호출 제한·비용** | **미측정** (C: 시간당 10 vs 분당 50 충돌) · 무료 | ? | ? |
| **제휴 정산** | ✔(원화·한국 계좌, 11-03) | ?(애드픽 경유 가능성 C) | ✔ 링크프라이스는 한국 정산 구조(B, 11-03) · 가격비교 재표시 권한 ? |

---

## 2. 같은 상품의 한국·일본 가격을 확보할 수 있는가

데이터를 5계층으로 구분해서 본다.

| 계층 | 일본 | 한국 |
|---|---|---|
| A. 제품 식별 | Rakuten Product Search(`productNo`·`makerName`, **라이브 미확인**) | Coupang/11st는 상품명뿐 → 모델번호는 제목에서 추출 |
| B. 판매처별 상품 | Rakuten Item(✔A), Yahoo(?) | Coupang(마켓 1리스팅), 11st(?) |
| C. 판매처별 현재가 | Rakuten Item(✔A) | Coupang(✔A) |
| D. 재고·구매 가능 | Rakuten Item(✔A) | Coupang ✘ / 11st ? |
| E. 구매 URL | Rakuten Item(✔A) | Coupang(✔A) |

**Rakuten Product Search의 `salesMinPrice`는 계층 B~E가 아니다.** 여러 샵의 최저가 롤업이며 판매자·URL·재고를
주지 않는다. 이번에 코드에서 이를 구조적으로 차단했다(§3).

### 답

- **일본 판매처별 가격**: Rakuten Ichiba Item Search로 **확보 가능**(코드 실가동 A). Yahoo는 유력하나 계정·상업이용이 미해결.
- **일본 내 복수 판매처**: Rakuten 안에서는 가능(샵 단위). 합성 실험에서 일본 판매처 2곳 묶음이 처리됨(§4) — **실제 측정 아님**.
- **한국 복수 판매처**: **현재 증명된 경로 없음.** Coupang은 판매자 구분이 없는 단일 마켓 리스팅이다. 11st가 유일한
  후보인데 권한(U)과 판매자 필드(B, 재확인 불가)가 모두 미확정이다.
- **한일 동일 상품 연결**: JAN 불가(한국 API에 없음). **브랜드 + 모델번호 토큰 + 최초 1회 사람 승인**이 유일한 현실 경로.

### 실제 상품 대표 26건 (`npm run supply:sample` → `docs/supply-sample-products.json`)

저장소의 실제 상품 정체성 448개 중 타입별 쿼터로 결정적 선정. 이 표는 **기존 데이터(R)** 이고 현재 가격 확보율이 아니다.

| 항목 | 수 |
|---|---|
| 선정 | 26 (camera 3, camera_lens 3, earbuds 2, headphones 2, smartwatch 2, dive_computer 3, regulator 2, bcd 2, fins 2, diving_mask 1, dive_light 1, wetsuit 1, beauty 2) |
| 모델번호를 저장소가 이미 아는 것 | **7** |
| 이름만 아는 것 | **19** |
| 과거 사람 검수에서 "exact"(Rakuten **또는** Coupang 한쪽) | 13 |
| PoC CSV에 한국·일본 판매처 URL이 **둘 다** 있는 것 | 3 |
| 저장소에 승인 리스팅이 있는 것 | 2 |
| **현재 판매처별 가격·재고 확보율** | **NOT_MEASURED (0건 측정)** |
| **한일 동일 상품 쌍 확보율** | **NOT_MEASURED** |

각 행에는 사용할 라이브 프로브 명령(`search-rakuten`, `search-coupang` 기존 CLI)이 들어 있다. 실행은 사용자 승인 사항이다.

### 정정: 기존 429건 베이스라인은 "양쪽 확보율"이 아니다

`build-matching-baseline.ts`의 `exact`는 **"Rakuten 또는 Coupang 어느 한쪽이라도 사람이 selected"** 이다
(코드 11행 주석). `missing_source`는 "Rakuten 0건"이다. 따라서 11-03 문서의 "한국 매칭 확정 75~92%"는
**과대 해석**이다. 베이스라인이 실제로 말해 주는 것은 *카테고리별로 일본(Rakuten)·한국(Coupang) 중 적어도 한쪽에서
정확한 리스팅이 존재했다*는 것뿐이다.

| 타입 (전체 풀, 한쪽 기준) | exact / 전체 | missing_source |
|---|---|---|
| camera | 60 / 69 | 0 |
| camera_lens | 73 / 79 | 2 |
| earbuds, headphones | 16/20, 17/20 | 1, 1 |
| smartwatch | 15 / 20 | 2 |
| dive_computer | 28 / 47 | 8 |
| bcd, fins, regulator | 13/53, 12/38, 7/19 | 32, 12, 0 |
| **dive_light, wetsuit** | **2/22, 2/20** | **17, 18** |

양쪽 분리 측정은 원본 `*.review.json`(Git에 없음, `main`에서도 4개 테스트가 ENOENT)이 있어야 가능하다 → **BLOCKED**.

### 카테고리가 결정한다

- **메인스트림 전자제품(카메라·렌즈·이어폰·스마트워치)**: 한쪽 기준 75~93%. API 경로가 현실적이고 제목에 모델번호가 노출된다.
- **다이빙 전문 용품**: PoC CSV의 한국·일본 판매처는 elfdive, scubajangbimall, hellodiving, swimnara, mic21 등
  **API가 없는 전문몰**이다. Rakuten·Coupang으로는 `missing_source`가 많고, 이 영역의 복수 판매처는 **몰 직접 피드/수동**이어야 한다.

---

## 3. 기존 통합 코드 안전성 점검 (코드 수정 있음)

대상: `rakutenProduct.ts`, `rakutenProductIntake.ts`, `providerListing.ts`, `listingIntakeService.ts`.
6개 질문을 프로브로 실행해 **수정 전 동작**을 확인했다.

| # | 질문 | 수정 전 | 조치 |
|---|---|---|---|
| 1 | 제품 정보와 판매처 정보 혼동? | **결함.** `rakuten_product` 롤업 행이 판매처 가격으로 취급되어 JP/KR "비교 가능" 그룹을 만들고 REVIEW 대상이 됨. 직전 브리지 테스트가 이 오류를 정상으로 고정해 둠 | `ProviderListing.priceBasis`(`seller_listing`/`product_aggregate`/UNKNOWN) 추가. 롤업은 `HOLD product_level_price_only`, `sourceUrl`=null. 중고·액세서리는 먼저 DROP |
| 2 | 같은 상품 여러 판매처가 개별 가격? | 정상 (키·가격·판매자 분리) | 테스트로 고정 |
| 3 | 모델번호 없는 상품이 자동 매칭? | 정상 (HOLD / 약한 증거 REVIEW만) | 없음 |
| 4 | 가격·재고 미확인인데 구매 가능 취급? | **부분 결함.** Coupang은 재고 필드가 없는데 아무 표시 없이 비교 후보로 계산 | 검수 사유에 `availability_unconfirmed` 추가 (공용 `marketQuoteService` 정책은 변경하지 않음) |
| 5 | 권한 미확인인데 공개 가능? | 정상 (전부 HOLD, denied는 DROP) | 없음 |
| 6 | 승인·신규 상태 혼동? | **결함.** 승인된 리스팅이 가격 null로 오면 `AUTO_REFRESH`로 분류되어 이전 가격을 null로 덮을 수 있음 | `HOLD approved_refresh_no_price` (이전 상태 유지). 신규 shopB는 승인된 shopA와 구분되어 `duplicate_market_offer` 검수 |

추가로 **가격 단위를 선언하지 않은 provider**는 `price_basis_unverified`로 HOLD한다(`usageRights`와 같은 원칙: 선언 전엔 불가).
Rakuten Item·Coupang 매퍼는 `seller_listing`을 기본 선언한다.

수정 효과 검증: 세 수정을 각각 되돌리는 변이 테스트에서 모두 해당 테스트가 실패했다. B의 기존 실험 결과(`docs/listing-intake-experiment-results.json`)는
처리 시간을 제외하고 **완전히 동일**하게 재현됐다(수정이 기존 측정 동작을 바꾸지 않음).

**남은 한계 (고치지 않음)**: ① `evaluateOfferEligibility`는 재고 미상(null)을 "구매 가능 후보"로 센다(공용 정책).
검수 화면이 `availability_unconfirmed`를 노출해야 한다. ② `snapshot`에는 권한이 `denied`인 리스팅도 이월 저장된다.
③ Coupang처럼 판매자 필드가 없는 provider는 같은 제목·같은 가격·다른 ID를 중복으로 DROP한다(서로 다른 판매자일 수 있음).

---

## 4. 합성 실험 결과 (R, 합성 — 실제 커버리지 아님)

`npm run intake:integrated` → `docs/integrated-intake-results.json`. 제품 롤업 행과 판매처 행을 분리해 생성.

| | 실제 정체성 기반 합성 | 가짜 3,000모델 |
|---|---|---|
| 롤업 행(발굴) | 11행(형식 오류 1 제외 10) → **10 전부 HOLD, REVIEW 유입 0** | 3,615행(형식 오류 203 제외) → **3,412 전부 HOLD, REVIEW 유입 0** |
| 판매처 행(Rakuten Item) | 18 | 6,631 |
| Coupang | 10 | 3,412 |
| REVIEW / AUTO_REFRESH / HOLD / DROP | 20 / 0 / 14 / 4 | 8,017 / 0 / 3,416 / 1,785 |
| 비교 가능 묶음(2개 이상 시장) | 8 (일본 판매처 복수 4) | 3,410 (일본 판매처 복수 1,060) |
| 정답 대비 오류 | 0 | 0 |

실제 정체성 448개 중 **7개만** 코드 매칭이 가능했다 → 위 합성 결과가 작은 이유. 템플릿 제목이라 100%는 **처리·안전 규칙의 증거이지 실제 정확도가 아니다.**

---

## 5. 구현 준비 사양 (API 연동 시 필요한 것)

| 공급처 | 인증 | 검색 | 필요 응답 필드 | 식별 방법 | 연결 위치 | 승인 필요 |
|---|---|---|---|---|---|---|
| Rakuten Item | applicationId+accessKey (보유) | keyword/itemCode/shopCode | itemCode, itemName, itemPrice, shopName, itemUrl, availability, shipOverseasFlag | 제목 토큰(JAN 없음) | `adapters/rakuten.ts` → `mapRakutenItem`(완료) | 제10조 원문 확인 |
| Rakuten Product | 동일 키 | genreId/keyword/JAN | productNo, makerName, productCode, salesItemCount | `productNo`(미검증) | `adapters/rakutenProduct.ts` + 브리지(완료, **발굴 전용**) | 라이브 1회 |
| Coupang | access/secret (보유) | keyword, limit≤10 | productId, productName, productPrice, productUrl | 제목 토큰 | `adapters/coupang.ts` → `mapCoupangProduct`(완료) | 약관·호출 한도 실측 |
| Yahoo v3 | appid (JP ID 필요) | query/jan_code/genre/store | **공식 페이지 미열람 — 아래 참고** | JAN | **신규** `adapters/yahooShopping.ts` + `mapYahooHit`(→`seller_listing`) | JP ID, 상업이용 문의 |
| 11st | OPEN API KEY(셀러 불필요) | ProductSearch, pageSize≤200 | 상품코드, 가격, 판매자, URL | 제목 토큰 | **신규** `adapters/elevenst.ts` | 약관·문의 회신 |
| Amazon JP | Creators 자격증명(승인된 Associates) | SearchItems | OffersV2 가격·availability | ASIN | 미착수 | JP Associates + 실적 요건 |
| 몰 피드 | 몰별 | 피드 파일 | 몰이 정의 | 몰 제공 | `mapGenericRow` + **`priceBasis:"seller_listing"` 선언 필수** | 몰별 허락 |

**Yahoo/11st 응답 필드명은 이번 세션에서 공식 페이지를 읽지 못했으므로 코드로 옮기지 않는다.** 어댑터는 도메인 허용 후
공식 페이지를 읽고 필드를 확정한 다음에만 작성한다(Rakuten Product 어댑터가 미확인 필드로 작성돼 라이브 검증이 선행조건인 것과 같은 위험).

### 최소 검증 절차 (사용자 승인 후, 전부 읽기 전용)

1. `npm run verify:rakuten-product` (≤6콜): `productNo` 채움 비율, `salesItemCount` 생존 여부. **중단 조건**: productNo 채움이 목표 장르에서 낮으면 발굴 전략 변경.
2. `npm run measure:coupang-limit -- --live`: 최초 403/429에서 자동 중단. 결과가 서비스 상한을 정한다.
3. `docs/supply-sample-products.json`의 `liveProbe` 명령으로 26개 × (Rakuten + Coupang) ≈ 52콜, 1.1초 간격. 판정: 상품별 판매처 단위 가격 확보 여부를 기록(이때 처음으로 "실측 커버리지"가 생긴다).
4. 결과를 `buildProviderBatch` → `runIntake`에 넣어 검수 묶음 수와 HOLD 사유 분포 확인. `providerRights`는 **약관 확인 전까지 선언하지 않는다**(전부 HOLD가 정상).

호출 비용: 전부 무료. 한도: Rakuten 1 QPS, Coupang 미측정, Yahoo 분당 30(B).

---

## 6. 전략: 세 범주

### ① 지금 바로 실험 가능 (기술 접근 가능 · 권한은 U)
- **Rakuten Ichiba Item Search** (일본 판매처별 가격, 코드 가동)
- **Rakuten Product Search** (발굴·모델번호 식별 전용, 라이브 검증 전)
- **Coupang Partners** (한국 가격 1점, 한도 실측 필요)

> "실험 가능"은 "운영 가능"이 아니다. 세 곳 모두 상업적 표시·저장 권한은 원문 미확인이다.

### ② 가입·승인·계약 이후
- **11번가 Open API** (한국 복수 판매처의 유일한 후보)
- **Yahoo Shopping v3** (JP ID + 상업이용 문의)
- **Amazon JP Creators API** (JP Associates 승인 + 판매 실적 요건)
- **링크프라이스 등 제휴 피드**, **몰 직접 피드**(다이빙 전문몰 등)

### ③ 현재 이용 가능성을 확인할 수 없음
- **ValueCommerce 상품 API** (현행 명세·해외 거주자 등록·정산 모두 U. 검색에서 1차 근거 0건)
- Amazon의 캐싱·저장 조건(출처 충돌)

### 추천 조합 TOP 2

1. **"Rakuten(Item+Product) × Coupang"** — *유일하게 지금 코드로 시작 가능.* 일본 판매처별 가격은 확보되나 **한국은 단일 마켓**이므로 "한국 내 복수 판매처 비교"는 성립하지 않는다. 메인스트림 전자제품에서 한일 가격 1:1 비교가 목표.
2. **조합 1 + 11st + Yahoo (승인 후)** — 한국·일본 모두 복수 판매처 비교 성립. 둘 다 권한·계정이 미해결이라 **계획이지 확정이 아니다.** 다이빙 전문 영역은 몰 피드를 병행.

---

## 7. 최종 질문 답

1. **일본 판매처별 가격 최적 공급처**: Rakuten Ichiba Item Search (코드로 증명된 유일한 곳). Yahoo는 잠재적으로 더 넓지만 미검증·미승인.
2. **한국 복수 판매처 가격**: **현재 증명된 경로 없음.** Coupang은 단일, 11st는 미승인.
3. **한일 동일 상품 연결**: 브랜드+모델번호 토큰 + 최초 1회 사람 승인. 모델번호 출처는 Rakuten `productNo`(미검증)와 제목.
4. **이용 권한이 원문으로 확인된 공급처**: **0곳** (8개 검토). 기술적으로 가동 중인 곳은 2곳(Rakuten, Coupang).
5. **100 → 1,000 이상에 필요한 것**: (a) `productNo` 채움률 확인 — 저장소 실제 상품 448개 중 모델번호 보유는 **7개(1.6%)**라서 모델번호 공급이 없으면 1,000개는 전부 사람 검수가 된다, (b) Coupang 호출 한도 실측, (c) 권한 원문 확인(Rakuten 제10조, Coupang, 11st), (d) 한국 복수 판매처 소스(11st 승인), (e) 자동 승인 레인 — 임계치 산출이 `review.json` 부재로 BLOCKED, (f) 카테고리 선별(메인스트림 전자제품 우선).
6. **지금 실행 가능 vs 승인 필요**: §8.
7. **반드시 고친 안전성 문제**: §3의 3건(롤업 가격의 판매처 혼동, 승인 리스팅 null 갱신, 재고 미상 무표시) — **수정 완료**.

---

## 8. 실행 계획

**지금 (승인 불필요, 완료)**: 코드 안전성 수정 + 테스트, 대표 26건 경로표, 합성 재검증, 이 문서.

**사용자 승인/조치가 필요한 것**

| # | 조치 | 막힌 이유 |
|---|---|---|
| 1 | 세션 허용 도메인에 `developer.yahoo.co.jp`, `webservice.rakuten.co.jp`, `openapi.11st.co.kr`(+`support.yahoo-net.jp`) 추가 | 약관 원문 직접 열람 불가 |
| 2 | 키가 있는 환경에서 §5 최소 검증 절차 1~3 실행 | 실제 외부 호출은 이번 작업 금지 |
| 3 | `*.review.json` 제공(또는 GCS 접근) | 양쪽 확보율·자동승인 임계치 산출 BLOCKED |
| 4 | Yahoo JP ID 개설 가능 여부 + 상업이용 문의 | 외부 계정 |
| 5 | 11번가 서비스 등록·약관 저장·문의 | 외부 계정 |
| 6 | 권한 확정 후에만 `providerRights` 선언 | 미확인 데이터 공개 금지 |

BLOCKED 항목과 무관하게 진행 가능한 독립 작업은 이미 끝냈다.

---

## 9. 판정

### **CONDITIONAL GO — 실험 단계 한정. 공개 확대·대량 등록은 HOLD**

- **GO 근거**: 일본 판매처별 가격 경로가 코드로 증명됨(Rakuten Item). 통합 파이프라인의 안전성 결함 3건을 수정했고 테스트로 고정. 카테고리(메인스트림 전자제품)별 경로가 구분됨.
- **GO가 아닌 이유**: 권한 확인 0곳 · 실제 판매처 가격 확보율 0건 측정 · 한국 복수 판매처 경로 없음 · 저장소 상품 중 모델번호 보유 1.6%.
- **HOLD로 바뀌는 조건**: `productNo` 채움률이 낮음 / Coupang 한도가 시간당 한 자리 / 11st가 상업이용 거절 / Rakuten 제10조가 저장·DB화 금지.

---

## 부록: 이번 세션에서 확인 시도한 출처 (2026-11-04)

직접 열람 **실패**(DNS): `developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html`, `webservice.rakuten.co.jp/guide/rule`, `openapi.11st.co.kr/openapi/OpenApiGuide.tmall`.

검색 발췌로만 확인(B/C, 원문 미열람):
- Amazon Creators API 온보딩·마이그레이션·best-practices: `affiliate.amazon.co.jp/creatorsapi`, `.../docs/en-us/onboarding`, `affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi`, `.../concepts/best-programming-practices`
- Yahoo 商品検索 v3 개요: `developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html` (검색 요약)
- ValueCommerce 웹서비스 연혁(C·낡음): `internet.watch.impress.co.jp/cda/news/2007/11/09/17464.html`, `valuecommerce.co.jp/en/news/c_press/1642/`

**미확인 조건**: Rakuten 제10조·Coupang·11st·Yahoo·Amazon JP·ValueCommerce의 상업적 표시/저장/재표시 조항 원문, ValueCommerce 현행 명세와 해외 거주 등록, 링크프라이스 피드 범위, Coupang 호출 한도, 11st 호출 한도, `productNo` 실제 채움률.
