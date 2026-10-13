"use client";

import type { VipRequest } from "@/src/lib/dancr/vip-types";
import { VenueRosterProfileButton } from "../internal/InternalRoster";
import VenueGridImage from "./VenueGridImage";
import "./venue-dancer-grid.css";

export default function VenueVipDancerCards({ dancers }: { dancers: VipRequest["dancers"] }) {
  return <div className="venue-vip-requested-dancers">
    <p><strong>Requested dancers</strong></p>
    <ul className="venue-dancer-grid" aria-label="Requested dancer profiles">
      {dancers.map(dancer => <li className="venue-dancer-card" key={dancer.id}>
        <VenueRosterProfileButton dancerId={dancer.id} stageName={dancer.stageName} className="ir-profile-link venue-card-profile">
          <span className="venue-card-portrait">
            <span className="venue-card-photo" aria-hidden="true"><VenueGridImage src={dancer.photoUrl} srcSet={dancer.photoSrcSet || undefined} sizes="(max-width: 620px) 30vw, 320px" lazy /></span>
            <span className="venue-card-caption"><strong>{dancer.stageName}</strong></span>
          </span>
        </VenueRosterProfileButton>
      </li>)}
    </ul>
  </div>;
}
