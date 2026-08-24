/**
 * Shared across every (site) page via layout.tsx (was previously hardcoded
 * only at the bottom of Home). Link labels are plain inert <span>s, not
 * <a>s - 이용약관/개인정보처리방침/문의 pages don't exist yet, so nothing
 * here is clickable. No business-registration info is included since none
 * has been provided.
 */
export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-logo">
          <span className="logo-a">얼마</span>
          <span className="logo-b">차이</span>
        </div>
        <div className="foot-desc">한국·일본 온라인 판매가를 비교해 얼마나 차이 나는지 알려드리는 가격비교 서비스입니다.</div>
        <div className="foot-links">
          <span>이용약관</span>
          <span>개인정보처리방침</span>
          <span>문의</span>
        </div>
        <div className="foot-disclaimer">
          표시된 가격은 각 온라인 판매처가 공개한 정보를 기준으로 확인 시점에 산정한 참고용 정보이며, 일본
          가격은 확인 시점의 환율을 적용해 원화로 환산해 보여드립니다. 환율 변동이나 판매처 가격 변경에 따라
          실제 결제 금액과 차이가 있을 수 있습니다. © 얼마차이
        </div>
      </div>
    </footer>
  );
}
