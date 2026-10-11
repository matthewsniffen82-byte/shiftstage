"use client";

import { useState } from "react";
import type { VipDancer } from "@/src/lib/dancr/vip-types";
import "./vip-my-dancers.css";

export function VipWorkingFavorites({ dancers, onRequest, onBrowse, busy }: {
  dancers: VipDancer[]; onRequest: (dancer: VipDancer) => void; onBrowse: () => void; busy: boolean;
}) {
  const working = dancers.filter(dancer => dancer.favorite && dancer.working_now && dancer.canRequest).slice(0, 4);
  return <section className="vip-working-favorites" aria-labelledby="vip-working-title">
    <div className="vip-library-heading"><h2 id="vip-working-title">Favorites working now</h2><button type="button" disabled={busy} onClick={onBrowse}>All club dancers <span aria-hidden="true">→</span></button></div>
    {working.length ? <ul className="vip-working-list">{working.map(dancer => <li key={dancer.id}>
      <LibraryPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} />
      <div><h3>{dancer.stage_name}</h3><small>Working now</small></div>
      <button type="button" disabled={busy} aria-label={`Request ${dancer.stage_name}`} onClick={() => onRequest(dancer)}>Request <span aria-hidden="true">→</span></button>
    </li>)}</ul> : <p className="vip-working-empty">None of your favorites are working at this venue right now.</p>}
  </section>;
}

function LibraryPhoto({ dancer }: { dancer: VipDancer }) {
  const [failed, setFailed] = useState(false);
  return <span className="vip-library-photo" aria-hidden="true">{dancer.photoUrl && !failed
    // Public media delivery rechecks profile visibility.
    ? <img src={dancer.photoUrl} alt="" width={64} height={80} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : dancer.stage_name.slice(0, 2).toUpperCase()}</span>;
}
