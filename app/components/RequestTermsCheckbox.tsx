"use client";
import { USER_TERMS_HREF } from "@/src/lib/dancr/user-terms-version";
import { ACCESS_TERMS_HREF } from "@/src/lib/dancr/access-terms";

export default function RequestTermsCheckbox({ table = false, disabled = false }: { table?: boolean; disabled?: boolean }) {
  return <div>
    <label className="club-transport-consent"><input type="checkbox" name="userTermsAccepted" required disabled={disabled} />
      <span>I’m 18 or older and agree to the <a href={USER_TERMS_HREF} target="_blank" rel="noreferrer">User Terms</a>{table ? <> and <a href={ACCESS_TERMS_HREF} target="_blank" rel="noreferrer">VIP &amp; Table Access Terms</a></> : null}.</span>
    </label>
    <p><a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></p>
  </div>;
}
