import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { internalScope } from "@/src/lib/dancr/internal-roster";
import { PrintSign } from "./PrintSign";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://www.mydancr.com";
  const scope = await internalScope(createAdminSupabaseClient(), new Request(origin), token).catch(() => null);
  if (!scope?.link) notFound();
  const url = new URL(`/internal/club/${token}`, origin).href;
  const qr = await QRCode.toDataURL(url, { width: 600, margin: 4, errorCorrectionLevel: "M" });
  return <main className="ir-sign"><p>mydancr · INTERNAL</p><h1>{scope.venueName}</h1><h2>{scope.link.label}</h2><img src={qr} alt={`Scan to open ${scope.link.label}`} /><p>{scope.link.kind === "table" ? "See who’s here. Tap an avatar to view her full profile. Send a request to club staff." : "Scan to open this club’s live display."}</p><p><a href={url}>Open roster</a></p><PrintSign /></main>;
}
