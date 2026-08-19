export function formatKrw(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export function formatPrice(n: number, currency: string): string {
  if (currency === "KRW") return formatKrw(n);
  if (currency === "JPY") return `¥${n.toLocaleString("ja-JP")}`;
  if (currency === "USD") return `$${n.toLocaleString("en-US")}`;
  return `${n.toLocaleString()} ${currency}`;
}

/** "8월 19일 확인" style - never "오늘" (see docs/phase1-design.md 표현 원칙) */
export function formatCheckedDate(iso: string | null): string {
  if (!iso) return "확인 이력 없음";
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 확인`;
}

export function formatCheckedDateTime(iso: string | null): string {
  if (!iso) return "확인 이력 없음";
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time} 확인`;
}

export const REGION_LABEL: Record<string, string> = {
  KR: "한국",
  JP: "일본",
  INTL: "해외직구",
};

export const CONFIDENCE_LABEL: Record<string, string> = {
  verified: "SKU 확인됨",
  estimated: "이름 매칭 (SKU 미확인)",
};
