"use client";

import type { ComponentProps } from "react";
import { trackSellerClick } from "../../lib/analytics";

type SellerClickParams = Parameters<typeof trackSellerClick>[0];

/**
 * Same plain <a>, just with a seller_click fire on click first - keeps the
 * real target="_blank" rel="noopener noreferrer" href navigation exactly as
 * it was; this is the main business KPI event.
 */
export function TrackedSellerLink({
  sellerClick,
  onClick,
  ...anchorProps
}: ComponentProps<"a"> & { sellerClick: SellerClickParams }) {
  return (
    <a
      {...anchorProps}
      onClick={(e) => {
        trackSellerClick(sellerClick);
        onClick?.(e);
      }}
    />
  );
}
