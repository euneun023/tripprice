import type { CanonicalProduct } from "./types";

/**
 * Mainstream category batch 1 (5 products, non-diving). Same engine as
 * divingBatch1 - only the data differs. Purpose: prove the Rakuten
 * search+match engine generalizes across categories, and specifically
 * stress-test capacity/formulation disambiguation (SK-II, Biore) and
 * body-vs-accessory disambiguation (Sony).
 */
export interface MainstreamProductUnderTest {
  product: CanonicalProduct;
  searchKeyword: string;
  /** exact SKU/model/JAN string to try first, if one is confirmed */
  exactSku?: string;
  /** normalized terms that must ALL appear in an item name for a name-based match */
  requiredTerms: string[];
  /** normalized terms that disqualify a candidate (accessories, sets, other variants) */
  excludeTerms: string[];
}

export const mainstreamBatch1: MainstreamProductUnderTest[] = [
  {
    product: {
      id: "skii-facial-treatment-essence-230ml",
      category: "beauty",
      brand: "SK-II",
      officialName: "SK-II Facial Treatment Essence 230ml",
      // JAN not confirmed - Rakuten listings vary by reseller
    },
    searchKeyword: "SK-II フェイシャルトリートメントエッセンス 230ml",
    requiredTerms: ["フェイシャルトリートメントエッセンス", "230"],
    // "ふるさと納税" added after live run #1: a hometown-tax donation reward
    // listing (¥105,000, ~5x normal retail price) matched first and is not
    // a comparable retail price source.
    excludeTerms: ["ミニ", "トライアル", "セット", "スターター", "詰め替え", "レフィル", "パウチ", "ふるさと納税"],
  },
  {
    product: {
      id: "biore-uv-aquarich-watery-essence",
      category: "beauty",
      brand: "Kao / Biore",
      officialName: "Biore UV Aqua Rich Watery Essence SPF50+/PA++++",
      // exact current-year gram size not confirmed ahead of time - checking via live results
    },
    searchKeyword: "ビオレUV アクアリッチ ウォータリーエッセンス",
    requiredTerms: ["アクアリッチ", "ウォータリーエッセンス"],
    excludeTerms: ["ジェル", "ムース", "ミスト", "クレンジング", "セット"],
  },
  {
    product: {
      id: "onitsuka-tiger-mexico66-1183c102-001",
      category: "fashion",
      brand: "Onitsuka Tiger",
      officialName: "Onitsuka Tiger MEXICO 66 (Black/White)",
      // Corrected 2026-08-16: decoded the official site's own color_json map
      // (previous "751 = White" claim was wrong - that came from an
      // unrelated nav-menu image alt text, not this product's data).
      // Real mapping: 751=YELLOW/BLACK, 001=BLACK/WHITE, 002=BLACK/BLACK,
      // 100=WHITE/BLUE. No pure "White" colorway exists for this style.
      // Using 001 (BLACK/WHITE), the classic colorway, confirmed via
      // onitsukatiger.com's own color_json.
      modelSku: "1183C102-001",
    },
    searchKeyword: "オニツカタイガー メキシコ66 1183C102",
    exactSku: "1183C102-001",
    requiredTerms: ["メキシコ66"],
    excludeTerms: ["シューレース", "靴紐", "シューキーパー", "スニーカーケア"],
  },
  {
    product: {
      id: "sony-wf-1000xm5",
      category: "electronics",
      brand: "Sony",
      officialName: "Sony WF-1000XM5 完全ワイヤレスイヤホン",
      modelSku: "WF-1000XM5",
    },
    searchKeyword: "SONY WF-1000XM5",
    exactSku: "WF-1000XM5",
    requiredTerms: ["WF-1000XM5"],
    excludeTerms: [
      "イヤーピース", "イヤピ", "ケース", "カバー", "ケーブル",
      "ストラップ", "フィルム", "保護", "スタンド", "クリップ", "互換",
    ],
  },
  {
    product: {
      id: "kinto-travel-tumbler-500-white-20942",
      category: "household",
      brand: "KINTO",
      officialName: "KINTO TRAVEL TUMBLER 500ml White",
      modelSku: "20942", // confirmed via web search - globally consistent per-color code (20941/20942/20944/20946)
    },
    searchKeyword: "KINTO トラベルタンブラー 500ml",
    exactSku: "20942",
    requiredTerms: ["トラベルタンブラー", "500"],
    excludeTerms: ["フタ", "パッキン", "部品", "替え蓋"],
  },
];
