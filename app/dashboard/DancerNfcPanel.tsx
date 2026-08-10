"use client";

import NfcIcon from "../components/NfcIcon";

export default function DancerNfcPanel() {
  return (
    <article className="info-panel dancer-nfc-panel" id="dancer-venue-verification">
      <div className="dancer-nfc-icon"><NfcIcon /></div>
      <div>
        <span className="eyebrow">Venue verification</span>
        <h2>Tap in the dressing room</h2>
        <p>At the venue, unlock your signed-in phone and tap the official MyDancr NFC sticker in the dressing room.</p>
        <ul>
          <li>The tag connects you only to that verified venue.</li>
          <li>Your reviewed profile becomes public after the first eligible tap.</li>
          <li>If you have a current posted shift there, the same tap checks you in.</li>
        </ul>
        <small>No manager scan or separate approval is required. Do not use a sticker outside the venue or shared by message. Disabled and rotated tags are rejected by the server.</small>
      </div>
      <style>{`
        .dancer-nfc-panel{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:start;border-color:rgba(126,87,255,.34);background:radial-gradient(circle at 0 0,rgba(116,60,255,.14),transparent 22rem),rgba(12,12,18,.88)}.dancer-nfc-icon{width:64px;height:64px;display:grid;place-items:center;border-radius:50%;color:#fff;background:linear-gradient(145deg,#4314b8,#842cff);box-shadow:0 0 28px rgba(125,59,255,.42)}.dancer-nfc-icon svg{width:38px;height:38px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.dancer-nfc-panel h2,.dancer-nfc-panel p{margin:4px 0}.dancer-nfc-panel p,.dancer-nfc-panel li,.dancer-nfc-panel small{color:#b9accd;line-height:1.45}.dancer-nfc-panel ul{margin:12px 0;padding-left:20px}.dancer-nfc-panel small{display:block}@media(max-width:620px){.dancer-nfc-panel{grid-template-columns:1fr}.dancer-nfc-icon{width:54px;height:54px}.dancer-nfc-icon svg{width:32px;height:32px}}
      `}</style>
    </article>
  );
}
