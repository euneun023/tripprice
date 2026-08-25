"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackSelectItem } from "../../lib/analytics";

type SelectItemParams = Parameters<typeof trackSelectItem>[0];

/**
 * Same next/link, just with a select_item fire on click first - renders
 * identical markup/behavior (href, prefetch, target navigation) to a plain
 * <Link>, so swapping it in changes nothing visible.
 */
export function TrackedProductLink({
  selectItem,
  onClick,
  ...linkProps
}: ComponentProps<typeof Link> & { selectItem: SelectItemParams }) {
  return (
    <Link
      {...linkProps}
      onClick={(e) => {
        trackSelectItem(selectItem);
        onClick?.(e);
      }}
    />
  );
}
