"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";

export default function PickupVenueIdentity({ id, name, slug }: { id: string; name: string; slug?: string }) {
  const [image, setImage] = useState<{ url: string; cover: boolean } | null>(() => {
    const url = verifiedVenueLogoUrl(slug);
    return url ? { url, cover: false } : null;
  });
  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    // Use the published venue profile. Private pickup credentials never accompany this request.
    void fetch(`/api/public/venues/${encodeURIComponent(slug)}`, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (controller.signal.aborted || !data?.ok || data.venue?.id !== id) return;
        const logo = data.venue.logoImageUrl || verifiedVenueLogoUrl(slug), url = logo || data.venue.coverImageUrl;
        if (typeof url === "string" && (url.startsWith("/") && !url.startsWith("//") || url.startsWith("https://"))) setImage({ url, cover: !logo });
      }).catch(() => { /* Venue artwork must never block access to chat. */ })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [id, slug]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase();
  return <div className="pickup-venue-identity">
    <div className={`pickup-venue-image${image?.cover ? " is-cover" : ""}`} aria-hidden="true">
      {image ? <>
        {/* Published venue logos keep their original proportions. */}
        <img src={image.url} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={() => setImage(null)} />
      </> : <span>{initials || "V"}</span>}
    </div>
    <div><p className="pickup-eyebrow">Venue pickup chat</p><h1>{name}</h1>
      {slug && <Link className="pickup-venue-link" href={`/?venue=${encodeURIComponent(slug)}`}>View club <span aria-hidden="true">↗</span></Link>}
    </div>
  </div>;
}
