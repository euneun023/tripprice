"use client";

import { useEffect } from "react";
import { trackViewItem } from "../../lib/analytics";

type ViewItemParams = Parameters<typeof trackViewItem>[0];

/** Renders nothing - fires view_item once per Product Detail entry (keyed
 * off variant_id, so navigating client-side between two product pages fires
 * again for the new variant). */
export function ViewItemTracker(params: ViewItemParams) {
  useEffect(() => {
    trackViewItem(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.variant_id]);

  return null;
}
