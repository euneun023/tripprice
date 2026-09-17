# Matching Baseline Summary (Phase 0)

`src/scripts/build-matching-baseline.ts`로 생성. 기존 human-review 산출물
(*.review.json + phase3-bcd는 searched.json/review-proposal.md)만 재사용했고,
matching 로직은 변경하지 않았다. 외부 API/GCP/DB 접근 없음.

## 전체 측정

| 항목 | 건수 |
|---|---|
| total | 429 |
| exact | 260 |
| obvious reject (accessory+wrong_category+variant_mismatch+bundle_condition_mismatch) | 49 |
| ambiguous | 22 |
| missing_source | 98 |
| manual-review-needed (reasoningRecorded=false — 이 스크립트가 근거 문서 없이 분류) | 16 |

## category 세부

| category | 건수 |
|---|---|
| exact | 260 |
| accessory | 11 |
| wrong_category | 22 |
| variant_mismatch | 7 |
| bundle_condition_mismatch | 9 |
| missing_source | 98 |
| ambiguous | 22 |

## productType별

| productType | total | exact | obvious reject | ambiguous | missing_source |
|---|---|---|---|---|---|
| bcd | 53 | 13 | 5 | 3 | 32 |
| camera | 69 | 60 | 7 | 2 | 0 |
| camera_lens | 80 | 74 | 3 | 1 | 2 |
| dive_computer | 47 | 28 | 9 | 2 | 8 |
| dive_light | 22 | 2 | 3 | 0 | 17 |
| diving_mask | 20 | 13 | 0 | 2 | 5 |
| earbuds | 20 | 16 | 0 | 3 | 1 |
| fins | 39 | 13 | 11 | 3 | 12 |
| headphones | 20 | 17 | 0 | 2 | 1 |
| regulator | 19 | 7 | 11 | 1 | 0 |
| smartwatch | 20 | 15 | 0 | 3 | 2 |
| wetsuit | 20 | 2 | 0 | 0 | 18 |

## 방법론 한계 (다음 phase에서 다룰 것)

- **documented** (reasoningRecorded=true, override 적용): review-proposal.md가 있는 9개
  배치(bcd/phase2-bcd/dive-light/phase2-camera/phase2-camera-lens/phase2-dive-computer/
  phase2-fins/regulator/phase3-bcd)는 사람이 이미 적어놓은 세부 판정을 그대로 옮겼다.
- **mechanical** (reasoningRecorded=true): exact(selected)와 missing_source(rakuten 0건)는
  review.json 필드만으로 확정 가능해 모든 배치에 동일하게 적용했다.
- **manual-review-needed** (reasoningRecorded=false): proposal 문서가 없는 나머지 배치에서
  no_match/pending인데 rakuten 결과가 있는 건은 왜 거절됐는지 이 스크립트가 재해석하지
  않고 전부 `ambiguous`로 남겼다 - accessory/wrong_category/variant_mismatch/
  bundle_condition_mismatch로 세분화하려면 각 listing 텍스트를 다시 읽는 human review가
  더 필요하다.
