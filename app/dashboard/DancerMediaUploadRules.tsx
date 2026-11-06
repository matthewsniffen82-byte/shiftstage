import "./dancer-media-upload-rules.css";
import DancerMediaRequirements, { type MediaRequirementProgress } from "./DancerMediaRequirements";

export default function DancerMediaUploadRules({ kind, facePhoto = false, progress }: { kind: "photo" | "video"; facePhoto?: boolean; progress?: MediaRequirementProgress }) {
  return <section className="dancer-media-upload-rules" aria-label={kind === "photo" ? "Photo rules" : "Video rules"}>
    <DancerMediaRequirements progress={progress} />
    <details key={kind} className="dancer-media-rules-disclosure">
      <summary>
        <span className="dancer-media-rules-label">
          <strong>{kind === "photo" ? "Photo rules" : "Video rules"}</strong>
          <span className="dancer-media-rules-prompt">Read before submitting</span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <ul>
        <li>Only you, 18+. No others in backgrounds or reflections.</li>
        {facePhoto ? <li>Keep your face clearly visible.</li> : null}
        <li>Bikinis, lingerie &amp; thongs OK. Cover nipples/private parts. No sex acts.</li>
        <li>No logos, watermarks, contact info, social/payment handles or QR codes.</li>
        <li>{kind === "video" ? "Own the video/music or have permission to share." : "Own the photos or have permission to share."}</li>
        <li>No drugs, violence, threats, hate or sexual solicitation.</li>
      </ul>
    </details>
    <p>{kind === "photo" ? "JPEG, PNG, WebP, HEIC/HEIF · 25 MB/photo" : "1–30 sec/video"} · Approval required.</p>
  </section>;
}
