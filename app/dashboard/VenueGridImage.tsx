"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src?: string | null;
  srcSet?: string;
  sizes?: string;
  pending?: boolean;
  lazy?: boolean;
  priority?: boolean;
};

function LoadedGridImage({ src, srcSet, sizes, lazy, priority }: Props & { src: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    // Cached images can finish before React attaches the load handler.
    if (image.current?.complete) setState(image.current.naturalWidth > 0 ? "ready" : "error");
  }, []);
  return <>
    <img ref={image} src={src} srcSet={srcSet} sizes={sizes} alt="" decoding="async"
      loading={lazy ? "lazy" : "eager"} fetchPriority={priority ? "high" : "auto"}
      data-venue-image-state={state}
      onLoad={() => setState("ready")} onError={() => setState("error")} />
    {state === "error" && <span className="venue-grid-image-unavailable">Photo unavailable</span>}
  </>;
}

export default function VenueGridImage({ src, srcSet, pending = false, ...props }: Props) {
  if (!src) return pending
    ? <span data-venue-image-state="loading" aria-label="Photo loading" />
    : <span className="venue-grid-image-unavailable">Photo unavailable</span>;
  // A replacement source gets its own readiness state; ordinary refreshes keep
  // the loaded image mounted, just as the homepage grid does.
  return <LoadedGridImage key={`${src}\u0000${srcSet || ""}`} src={src} srcSet={srcSet} {...props} />;
}
