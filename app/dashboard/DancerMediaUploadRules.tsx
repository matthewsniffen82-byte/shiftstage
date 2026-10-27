import "./dancer-media-upload-rules.css";

export default function DancerMediaUploadRules({ kind, facePhoto = false }: { kind: "photo" | "video"; facePhoto?: boolean }) {
  return <details className="dancer-media-upload-rules">
    <summary>
      <strong>{kind === "photo" ? "Photo rules" : "Video rules"}</strong>
      <span>Only you (18+). Cover nipples and private parts. No sex acts, logos, or contact details.</span>
    </summary>
    <ul>
      <li>Only you (18+) may appear, including in backgrounds and reflections. No other people or minors.</li>
      {facePhoto ? <li>Your face must be clearly visible in your face photo.</li> : null}
      <li>Bikinis, opaque lingerie, thongs, and cleavage are allowed when nipples, areolas, genitals, and anus are covered. Exposed buttocks from a thong are allowed. No sex acts or masturbation.</li>
      <li>No visible brands, logos, or watermarks, including on clothing, accessories, and in the background.</li>
      <li>No phone numbers, emails, social or payment handles, or QR codes anywhere in the {kind}.</li>
      <li>{kind === "video"
        ? "You must own or have permission to publish all visuals and audio, including music."
        : "Use photos of yourself that you own or have permission to publish."}</li>
      <li>No sexual solicitation, drug use or sales, graphic violence, weapon threats, self-harm, hate, harassment, threats, coercion, nonconsensual content, or deceptive impersonation.</li>
    </ul>
    {kind === "photo" ? <p>JPEG, PNG, WebP, HEIC, or HEIF. Up to 25 MB per photo.</p> : null}
    <p>Uploads are reviewed before they appear publicly. Unclear content may need a manual review.</p>
  </details>;
}
