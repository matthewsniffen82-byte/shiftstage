import "./dancer-media-upload-rules.css";

export default function DancerMediaUploadRules({ kind, facePhoto = false }: { kind: "photo" | "video"; facePhoto?: boolean }) {
  return <section className="dancer-media-upload-rules" aria-label={kind === "photo" ? "Photo rules" : "Video rules"}>
    <strong>{kind === "photo" ? "Photo rules" : "Video rules"}</strong>
    <ul>
      <li>Only you, 18+. No others in backgrounds or reflections.</li>
      {facePhoto ? <li>Keep your face clearly visible.</li> : null}
      <li>Bikinis, lingerie &amp; thongs OK. Cover nipples/private parts. No sex acts.</li>
      <li>No logos, watermarks, contact info, social/payment handles or QR codes.</li>
      <li>{kind === "video" ? "Own the video/music or have permission to share." : "Own the photos or have permission to share."}</li>
      <li>No drugs, violence, threats, hate or sexual solicitation.</li>
    </ul>
    <p>{kind === "photo" ? "JPEG, PNG, WebP, HEIC/HEIF · 25 MB/photo" : "1–30 sec/video"} · Approval required.</p>
  </section>;
}
