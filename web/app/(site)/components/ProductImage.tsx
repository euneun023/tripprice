"use client";

import { useState } from "react";
import Image from "next/image";

function FallbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#9AA3B2" strokeWidth={1.6} style={{ width: "26%" }}>
      <rect x="6" y="4" width="12" height="17" rx="4" />
      <circle cx="12" cy="11" r="3.2" />
      <path d="M9.6 4.5V3M14.4 4.5V3" />
    </svg>
  );
}

/**
 * Real product photo when we have one (product_variants.image_url, hotlinked
 * from the source marketplace's own CDN), otherwise a plain neutral
 * placeholder icon - never a fake/stock photo. object-fit: contain per spec
 * so real product photos (often on white/transparent backgrounds) aren't
 * cropped oddly.
 */
export function ProductImage({
  src,
  alt,
  className,
  sizes,
}: {
  src: string | null;
  alt: string;
  className: string;
  sizes: string;
}) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className={`${className} ${className}--empty`}>
        <FallbackIcon />
      </div>
    );
  }

  return (
    <div className={className}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        style={{ objectFit: "contain" }}
        onError={() => setErrored(true)}
      />
    </div>
  );
}
