"use client";
import VipDancerPhoto from "./VipDancerPhoto";

import { isVipFollowing } from "@/src/lib/dancr/vip-dashboard";
import type { VipDancer } from "@/src/lib/dancr/vip-types";
import "./vip-my-dancers.css";

export function VipWorkingFollowing({ dancers, onRequest, onBrowse, busy }: {
  dancers: VipDancer[]; onRequest: (dancer: VipDancer) => void; onBrowse: () => void; busy: boolean;
}) {
  const working = dancers.filter(dancer => isVipFollowing(dancer) && dancer.working_now && dancer.canRequest).slice(0, 4);
  return <section className="vip-working-following" aria-labelledby="vip-working-title">
    <div className="vip-library-heading"><h2 id="vip-working-title">Dancers you follow working now</h2><button type="button" disabled={busy} onClick={onBrowse}>All club dancers <span aria-hidden="true">→</span></button></div>
    {working.length ? <ul className="vip-working-list">{working.map(dancer => <li key={dancer.id}>
      <LibraryPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} />
      <div><h3>{dancer.stage_name}</h3><small>Working now</small></div>
      <button type="button" disabled={busy} aria-label={`Request ${dancer.stage_name}`} onClick={() => onRequest(dancer)}>Request <span aria-hidden="true">→</span></button>
    </li>)}</ul> : <p className="vip-working-empty">No dancers you follow are working at this venue right now.</p>}
  </section>;
}

function LibraryPhoto({ dancer }: { dancer: VipDancer }) {
  return <span className="vip-library-photo" aria-hidden="true"><VipDancerPhoto dancer={dancer} width={64} height={80} /></span>;
}
