import "./dancer-media-upload-rules.css";

export default function DancerMediaUploadRules({ kind, facePhoto = false }: { kind: "photo" | "video"; facePhoto?: boolean }) {
  return <section className="dancer-media-upload-rules" aria-label={kind === "photo" ? "Photo rules" : "Video rules"}>
    <strong>{kind === "photo" ? "Photo rules" : "Video rules"}</strong>
    <ul>
      <li>Only you, age 18+. No other people, including backgrounds or reflections.</li>
      {facePhoto ? <li>Keep your face clearly visible.</li> : null}
      <li>Bikinis, lingerie and thongs are OK. Cover nipples and private parts. No sex acts.</li>
      <li>No logos, watermarks, contact details, social/payment handles or QR codes.</li>
      <li>{kind === "video" ? "Use video and music you own or have permission to share." : "Use pictures you own or have permission to share."}</li>
      <li>No drugs, violence, threats, hate or sexual solicitation.</li>
    </ul>
    <p>{kind === "photo" ? "JPEG, PNG, WebP, HEIC or HEIF · Up to 25 MB each." : "1–30 seconds per video."} Approval required before posting.</p>
  </section>;
}
