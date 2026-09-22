# Working Now and club participation

Dancer accounts belong to the dancer. A club's withdrawal or roster removal does not delete the dancer's account, public profile, photos, videos, or connections to other clubs.

Upcoming club posts are retired. The dashboard has no scheduling form, authenticated schedule mutation routes return 410, and the database rejects scheduled posts from older clients. The migration cancels existing future posts while preserving current verified check-ins and historical records.

Public club association requires a current, confirmed check-in at an active participating club. A check-in lasts six hours under the existing NFC policy. Profiles, discovery cards, and TV responses omit the club once that presence expires or ends. Discovery refreshes on focus and every 30 seconds while visible; already loaded content updates on its next refresh.

Both six-hour and flexible clubs use the same check-in/check-out flow. Dancers use **Dancer dashboard → Working Now → End Working Now** when leaving early. Club owners, managers, and staff use **Club dashboard → Affiliated dancers → End check-in** beside a dancer currently working. Staff checkout ends only the selected session, keeps the dancer approved on the roster, preserves their account and media, and records the action in club activity. Retries cannot end a newer session. Demo sessions stay centrally managed. The existing six-hour expiry and tap cooldown remain in effect; checkout does not reset the cooldown or enforce a minimum stay.

Club owners can use **Account & support → Club participation → Remove club from MyDancr**. Removal is atomic: the club listing is unpublished, affiliations revoked, current check-ins ended, future posts cancelled, and tap stickers and pending enrollments revoked. A failure rolls back the operation. A private withdrawal record prevents old taps and publication controls from restoring the club. Returning requires MyDancr to review a new agreement; there is no automatic reactivation button.

Owners and roster managers can remove individual dancers in **Dancer check-ins**. Removal immediately ends that club's check-in and blocks reconnection. **Removed dancers → Allow new tap** permits a returning dancer to reconnect through a fresh dressing-room tap; it does not itself restore the affiliation or start Working Now. A dancer leaving voluntarily can remove their own affiliation through the existing dancer control.

Club staff still need to report departures and use these controls. A tap cannot establish whether employment or permission has ended. This change does not introduce periodic roster reconfirmation. Club references embedded in biographies, photos, videos, or external social pages require separate content review; removing structured club links does not edit those materials.
