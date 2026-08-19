import type { CanonicalProduct } from "./types";

/**
 * Diving batch 1 (5 products). Category is data on each product, not a
 * branch in code - the same search+match engine runs for all of them.
 */
export interface ProductUnderTest {
  product: CanonicalProduct;
  /** Rakuten keyword search string */
  searchKeyword: string;
  /** normalized terms that must ALL appear in an item name for an automatic match */
  matchTerms: string[];
}

export const divingBatch1: ProductUnderTest[] = [
  {
    product: {
      id: "garmin-descent-mk3s-010-02857-02",
      category: "diving",
      brand: "Garmin",
      officialName: "Garmin Descent Mk3s (Steel/Fog Gray, 43mm)",
      modelSku: "010-02857-02",
    },
    searchKeyword: "Garmin Descent Mk3s",
    matchTerms: ["010-02857-02"],
  },
  {
    product: {
      id: "suunto-d5",
      category: "diving",
      brand: "Suunto",
      officialName: "Suunto D5 Dive Computer",
      // no official model code confirmed at research time (color-variant SKUs differ)
    },
    searchKeyword: "Suunto D5 ダイブコンピューター",
    matchTerms: ["suunto", "d5"],
  },
  {
    product: {
      id: "mares-avanti-quattro-power",
      category: "diving",
      brand: "Mares",
      officialName: "Mares Avanti Quattro Power Diving Fins",
      // SKU varies by color, not confirmed at research time
    },
    searchKeyword: "Mares Avanti Quattro Power フィン",
    matchTerms: ["avanti", "quattro", "power"],
  },
  {
    product: {
      id: "shearwater-peregrine",
      category: "diving",
      brand: "Shearwater Research",
      officialName: "Shearwater Peregrine (Original/Standard, Black)",
      modelSku: "16001", // series-level, per CSV "16001 계열"
    },
    searchKeyword: "Shearwater Peregrine ダイブコンピューター",
    matchTerms: ["shearwater", "peregrine"],
  },
  {
    product: {
      id: "gull-mantis5",
      category: "diving",
      brand: "GULL",
      officialName: "GULL MANTIS5 다이빙 마스크",
      // SKU not confirmed at research time
    },
    searchKeyword: "GULL MANTIS5 マスク",
    matchTerms: ["mantis5"],
  },
];
