import type { CSSProperties } from "react";
import { CATEGORIES } from "../../../lib/categories";
import { PRODUCT_TYPES } from "@core/domain/searchAliases";

const PRODUCT_TYPE_LABELS: Record<(typeof PRODUCT_TYPES)[number], string> = {
  camera: "카메라",
  camera_lens: "카메라 렌즈",
  earbuds: "이어폰",
  headphones: "헤드폰",
  smartwatch: "스마트워치",
  dive_computer: "다이브컴퓨터",
  diving_mask: "다이빙 마스크",
  fins: "핀(오리발)",
  wetsuit: "웻슈트",
};

// The only page in this app that wasn't already force-dynamic - opted in so
// it gets a per-request CSP nonce from proxy.ts like every other page
// (nonce-based CSP only works for dynamically-rendered pages; a statically
// generated one has no per-request nonce to inject into Next's own
// framework scripts).
export const dynamic = "force-dynamic";

export default function NewProductPage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>새 canonical product 등록</h1>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>
        여기서는 상품(개념)과 대표 variant 1개만 만듭니다. 판매처 매핑(승인)은 등록 후 상품 상세 화면에서 진행합니다.
        대량 import 기능은 아직 없습니다.
      </p>

      <form action="/admin/api/products" method="POST" style={{ display: "grid", gap: 14 }}>
        <label>
          카테고리
          <select name="category" required style={inputStyle}>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.dbCategory}>
                {c.label} ({c.dbCategory})
              </option>
            ))}
            <option value="">기타 (직접 입력은 아래 브랜드/상품명에 반영)</option>
          </select>
        </label>

        <label>
          브랜드
          <input name="brand" required style={inputStyle} placeholder="예: Sony" />
        </label>

        <label>
          공식 상품명
          <input name="officialName" required style={inputStyle} placeholder="예: WF-1000XM5" />
        </label>

        <label>
          상품유형 (product_type)
          <select name="productType" required style={inputStyle} defaultValue="">
            <option value="" disabled>
              선택하세요
            </option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]} ({t})
              </option>
            ))}
          </select>
        </label>

        <fieldset style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: 14 }}>
          <legend style={{ fontSize: 13, color: "#666" }}>대표 variant (없으면 비워두면 됨)</legend>
          <label>
            모델번호 / SKU (선택)
            <input name="modelSku" style={inputStyle} placeholder="예: 010-02857-02" />
          </label>
          <label style={{ marginTop: 10, display: "block" }}>
            variant 표시명 (선택, 색상/사이즈 등이 없는 상품용)
            <input name="displayName" style={inputStyle} placeholder="예: 기본형" />
          </label>
        </fieldset>

        <button type="submit" style={{ ...inputStyle, background: "#111", color: "#fff", cursor: "pointer" }}>
          등록
        </button>
      </form>
    </main>
  );
}

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
};
