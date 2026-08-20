# How to use this packet

This packet combines a factual product map with draft public policies and bilateral agreements for specialist counsel. It is deliberately written from the product’s actual roles, database concepts, verification gates, public/private surfaces, Club Deal attribution, NFC events, moderation workflow, and finance ledgers. Counsel should use the product map to test every promise in the operative drafts and should resolve the decision register before any document is published or accepted by users.

[CALLOUT:COUNSEL|Drafting status] This is a working draft for licensed counsel. It is not legal advice, is not a legal opinion, and is not approved for publication or user acceptance. Defined terms avoid blanks where possible, but the publishing entity, governing law, dispute procedure, addresses, tax treatment, payout schedule, retention schedule, and insurance requirements must be finalized by counsel.

[CALLOUT:PRODUCT FACT|Production providers] This packet assumes **Yoti** provides MyDancr’s identity and age-verification workflow. No commission payout provider is currently designated. MyDancr must select a legally and contractually approved payout provider before live payouts are enabled, and the provider’s terms, privacy notice, geographic availability, and legal entity must be verified against the signed production contract before publication.

## Packet contents

1. Executive counsel dashboard and decision register.
2. Factual product map and end-to-end data, payment, commission, upload, verification, notification, and deletion flows.
3. Draft Terms of Service.
4. Draft Privacy Policy.
5. Draft Dancer Agreement.
6. Draft Club Agreement.
7. Draft Content and Media Consent/License.
8. Draft Acceptable Use and Prohibited Conduct Rules.
9. Draft Age, Identity, and Venue-Verification Policy.
10. Draft DMCA and Takedown Policy.
11. Draft Club Deal and NFC Redemption Terms.
12. Draft Dancer Commission, Agent Referral, and Payout Terms.
13. Draft Moderation, Reporting, Suspension, and Appeals Policy.
14. Draft Data-Retention and Account-Deletion Policy.
15. Implementation checklist, acceptance matrix, and selected primary authorities.

# Executive counsel dashboard

## Product position

MyDancr is a mobile-first discovery and promotion platform for lawful adult-entertainment clubs and adult dancers who are legally permitted to work at those clubs. It lets users discover public dancer profiles, public club pages, venue-confirmed affiliations, current or upcoming schedules, short promotional media, directions, admission or line-access Club Deals, and MyDancr TV. It lets clubs maintain pages, teams, rosters, Club Deals, venue media, NFC tags, and referral-fee records. It lets dancers manage their public profiles, media, social links, venue affiliations, shifts, visibility, analytics, and commissions. It supports follows, favorites, “going” signals, notifications, support, reporting, DMCA notices, moderation, and account controls.

MyDancr is not a booking service for private performances, escorting, prostitution, sexual services, dating, personal messaging, alcohol sales, employment placement, payment for dancer services, or transportation. Directions and rideshare links are convenience links. Club Deals are limited to lawful admission or line-access benefits and remain subject to the club’s capacity, age, dress-code, licensing, and house rules.

[CALLOUT:HIGH RISK|Core boundary] Every public description, onboarding screen, sales script, agent script, moderation rule, and club workflow must preserve the line between lawful club promotion and arranging sexual services. The platform should not enable pricing, booking, messaging, negotiation, or payment for private or sexual services.

## Current drafting positions

- **Age floor:** no one under 18 may create or use an account; clubs may impose a higher age threshold, including 21, and dancers must meet every work-card, licensing, and venue requirement.
- **Dancer public gate:** a first-time dancer’s profile remains private until required profile information and media are approved and an authorized club representative confirms a venue affiliation through the approved verification flow.
- **Ongoing affiliations:** after initial approval, a dancer may seek additional or replacement club affiliations from the dancer workspace. Shifts may be posted only for clubs with an active approved affiliation.
- **Working Now:** a production Working Now state is created by a time-limited, server-validated presence event, such as an approved dressing-room NFC tap. Demo-locked data cannot generate commissions.
- **Club Deals:** only admission and line-access offers are permitted. Alcohol, drink, bottle-service, sexual-service, gambling, cash-equivalent, or unlawful offers are prohibited.
- **Redemption:** a Club Deal becomes verified only after server confirmation tied to the correct club’s approved cashier NFC tag and the deal’s valid redemption token.
- **Dancer commission:** only an eligible Club Deal redemption whose immutable source originated from a dancer’s public profile and that is successfully confirmed by the correct authorized cashier NFC tag counts toward that dancer’s monthly tier. The dancer earns **30% on qualifying monthly redemptions 1–9, 40% on 10–24, and 50% on 25 and above**, calculated from the applicable MyDancr gross referral fee—not admission price, deal face value, club gross revenue, tips, or dancer-service compensation.
- **Separate ledgers:** the club’s obligation to MyDancr and MyDancr’s obligation to the dancer are independent. A club’s late payment does not, by itself, cancel an otherwise payable dancer reward.
- **Agent compensation:** no person earns an agent commission merely by recruiting, referring, or claiming a relationship. Any agent program requires separate written authorization, an accepted Agent Order or rider, identity/tax verification, and event-based attribution. No multi-level or downline compensation is permitted.
- **Identity verification:** Yoti is the assumed production verification provider for dancer age/identity and any risk-based club or agent checks. MyDancr remains responsible for deciding what is required, giving notice, reviewing the returned result, and providing a lawful alternative where required.
- **Payouts:** live dancer and authorized-agent commission payouts remain disabled until MyDancr selects an approved payout provider. Once selected, payees must complete the provider’s secure onboarding, pass its KYC and compliance checks, and ensure that MyDancr and provider records match.
- **Media:** uploads undergo technical validation and automated and/or human moderation. Public media must belong to the uploader, depict consenting adults, comply with platform rules, and remain within current duration/count limits.
- **No direct messaging:** the current product does not offer customer-to-dancer direct messaging. Support messaging is between an account holder and MyDancr support.

## Decisions counsel must finalize

1. Identify the exact operating legal entity, state of formation, principal address, support address, privacy request address, legal-notice address, and DMCA agent.
2. Decide whether the public service is Nevada-only at launch or available in additional states, and prepare a state-by-state licensing and privacy addendum before expansion.
3. Decide whether all customer accounts must be 21+ or whether 18+ accounts may browse clubs whose own entry age varies.
4. Approve the exact Yoti product configuration for dancers, club owners/managers, and agents, including requested attributes, ID/selfie/liveness/face-match checks, biometric consent, U.S. state biometric notices, manual-review access, retention time-to-live, and fallback process.
5. Confirm whether any uploaded media could fall within 18 U.S.C. §§ 2257/2257A and assign recordkeeping, labeling, custodian, inspection, and producer responsibilities.
6. Select and approve a legally suitable payout provider and its business configuration, beneficiary onboarding, payout cadence, minimum threshold, reserves/holds, rejected-payment procedure, inactivity treatment, fees, supported countries/currencies, sanctions screening, tax-document workflow, complaints path, and unclaimed-property handling.
7. Decide whether an agent program will launch. If yes, approve a separate Agent Agreement, commission schedule, non-solicitation/marketing standards, attribution duration, clawback rules, and licensing analysis.
8. Approve the club referral-fee order form, invoice timing, payment processor, late fees, disputes, chargebacks, taxes, and collection procedure, and confirm the nonretroactive profile-originated dancer tiers—30% for monthly events 1–9, 40% for 10–24, and 50% for 25 and above—against tax, worker-classification, referral, and gaming/sweepstakes concerns.
9. Choose governing law, venue, arbitration/class-action waiver, small-claims carveout, opt-out process, and consumer-law savings language.
10. Approve warranty disclaimers, liability caps, indemnities, insurance minimums, and special allocation for clubs, dancers, agents, and the platform.
11. Approve exact retention periods by record class, including media, moderation evidence, NFC/device logs, geolocation, finance/tax records, DMCA, support, reports, account-recovery events, and backups.
12. Confirm Nevada privacy requirements and whether CCPA/CPRA, other comprehensive state privacy laws, GDPR/UK GDPR, biometric laws, consumer-health-data laws, or employment/privacy laws apply.
13. Confirm communications compliance for push, email, and any future SMS, including consent, quiet hours, marketing classification, opt-out, and recordkeeping.
14. Approve the appeal standard, response targets, emergency suspension authority, repeat-infringer rule, law-enforcement process, and preservation/legal-hold protocol.
15. Determine worker-classification, agency, referral, tax, and local licensing consequences without implying that MyDancr employs dancers or controls club performance work.

---PAGE---

# Part I — Factual Product Map

## 1. Product purpose and lawful boundaries

MyDancr’s customer-facing purpose is to answer: who is publicly approved, who is currently working at a confirmed club, who has an upcoming posted shift, where the club is, what lawful admission or line-access benefit is available, and what promotional media the dancer or club has published. Its club-facing purpose is to maintain accurate public venue information, verify affiliations, manage authorized staff, publish allowed offers, operate approved NFC touchpoints, and review referral activity. Its dancer-facing purpose is to establish a public professional profile, publish compliant promotional media and social links, obtain club-confirmed affiliations, post eligible shifts, control visibility, and view attributable reach and rewards.

The product should never be described as guaranteeing that a dancer is physically present, available to a particular patron, employed by a particular club, willing to interact, or offering any private service. A current status is a time-limited signal derived from approved data. Club admission and access always remain within club control.

## 2. Account and actor map

### Customer

A customer may browse qualifying public pages without an account, subject to session-based analytics and fraud controls. A registered customer uses email/password authentication and a private customer profile that can include city and notification preferences. Customer features include following dancers and clubs, saving or favoriting content and deals, using “going” signals, receiving notifications, viewing directions, and participating in Club Deal redemption. The service does not expose a customer’s identity or contact details to dancers as a communication channel.

### Dancer

A dancer creates an email/password account, selects a city, and enters a private onboarding workspace. Private data may include legal identity or verification readiness; public data may include stage name, city, avatar, profile photos, short videos, bio, official social links, approved club affiliations, schedule status, and engagement counts. The dancer controls public visibility subject to approval, moderation, affiliation, account-state, and safety rules.

### Club

A club account is created through an administrator-issued single-use access code or authorized team invitation. Club accounts are associated with a venue record. Team access is segmented into owner, manager, or staff permissions. Club features include public profile management, cover media, roster/affiliation review, allowed Club Deals, club video, NFC tag support, team invitations, billing/finance visibility appropriate to role, and activity logs.

### Administrator and support

Administrators review profiles, photos, videos, social links, clubs, claims, affiliations, Club Deals, reports, support escalations, DMCA cases, NFC lifecycle, finance events, and operational health. Elevated actions should be role-restricted and audited. Support agents can respond within the authorized support scope and must not request passwords, reset codes, unnecessary government identification, or payout credentials by ordinary email.

### Authorized agent

An agent is not an ordinary customer, dancer, or club role. If MyDancr activates an agent program, an agent is a separately contracted business-development or referral participant with written authorization and a defined commission order. Agent compensation must be based on specified verified revenue events, not mere recruitment, account creation, or a downline. Agent personal, tax, and payout data remains private.

## 3. Authentication and account lifecycle

Authentication uses email and password with email confirmation and password-reset flows. Role is assigned on approved signup paths. Venue registration requires a valid code or invitation. Administrative signup is separately protected. Account settings support email and password changes, disabling, and deletion. Password changes should invalidate other sessions and trigger a security notice.

Account recovery is a support workflow for signed-out users who no longer control the registered email. It accepts an account description, city, reachable email, and details; creates an auditable support/report record; and sends a reference. The workflow must not disclose whether a particular email is registered and must not invite sensitive credentials over email.

## 4. Dancer onboarding and public eligibility

The first-time dancer flow is staged: create the account; save stage name and city; complete the required Yoti age/identity session; upload and approve an avatar; upload the required profile photos; optionally add social links and videos; preview the complete customer-facing profile; submit; and complete first venue verification through an approved club touchpoint. The public preview should use the same rendering and approved content that a live profile will use, while clearly identifying its private preview state.

Public eligibility is the conjunction of several conditions, not a single status flag: active account, approved dancer status, a successful and current Yoti verification result accepted by MyDancr, public visibility enabled, no disablement, required approved media, and the required approved venue affiliation. Media still pending or rejected does not count toward approval. Deleting media must remove the active database record and associated public/storage reference, subject only to backup, legal-hold, and audit retention described later.

After first approval, the dancer can request or establish additional affiliations through the controlled club verification flow. The dancer can post a shift only for an active club affiliation. This avoids self-assigning a club relationship.

## 5. Venue affiliation, NFC presence, and geolocation

The dressing-room NFC flow uses an approved venue tag with an unguessable token or digest, lifecycle state, club association, and audit data. A valid tap can activate or update a venue affiliation, complete the initial club gate, or begin a time-limited Working Now session. The server checks account eligibility, tag status, club relationship, event timing, and duplicate/cooldown rules. It records the tap and associated device/IP audit data.

The current product model uses a six-hour Working Now window followed by a six-hour cooldown for the NFC lifecycle. A session should end at the earlier of its server expiry, a valid checkout/end event, administrative action, or account/affiliation invalidation. A new tap must not silently extend a prohibited session. Historical records can retain start/end and summary fields even after the public status ends.

Where geolocation verification is used, the product collects client latitude, longitude, stated accuracy, and reading time for the narrow purpose of confirming proximity to the club. Current implementation controls include a 300-foot maximum distance, accuracy no worse than 75 meters, and a location reading no older than 30 seconds. Raw location should not be exposed publicly or to other users.

Demo-locked Working Now records are fictional demonstration data. They must not impersonate a real NFC tap, create a real affiliation, or generate commission.

## 6. Shifts and public discovery

A dancer shift has a club, date, start/end time, state, and source. Exact internal times may be used for eligibility and lifecycle controls even when the public interface presents a simpler date/status. Creation and edits must validate dates, durations, affiliation, ownership, and state transitions. Deleting or canceling a shift should not cause uncontrolled screen movement, and historical financial/audit records must not be destroyed if they reference the shift.

Public discovery filters by city and product status. It can show Working Now, Upcoming, and No Schedule Posted groupings, public club pages, trending rankings, and MyDancr TV. Rankings may use profile views, schedule views, follows, favorites, going signals, directions, notification engagement, and social clicks. Rankings are dynamic engagement signals, not endorsements, guarantees of availability, employment rankings, or measures of personal worth.

## 7. Media, profiles, and MyDancr TV

Profile images and videos are uploaded to controlled storage. The server should validate claimed file type against signature, dimensions, duration, count, size, and ownership; normalize or transcode when needed; strip risky metadata; create display variants; apply branding/watermarks where disclosed; and keep nonpublic review assets out of public buckets. Current video policy allows short uploads of up to 30 seconds and limits the number of profile videos. A video may be published to the profile and feed or, where the workflow supports it, to the feed only.

Moderation uses automated and/or human review. Automated decisions are aids, not guarantees. Review records should identify the asset, version, model or reviewer, decision, reason code, timestamps, and administrative overrides. Media involving minors, nonconsensual imagery, apparent exploitation, actual sexual services, illegal activity, extreme violence, or infringing content must be rejected and escalated as applicable.

Social links are dancer-supplied public links to supported platforms. MyDancr should validate protocol and platform/username format, make clear that third-party sites have their own terms and privacy practices, and remove links used to facilitate prohibited conduct.

MyDancr TV presents approved short video cards with dancer identity, city, eligible schedule/club information, and user controls such as applause/favorite, share, follow, report, mute, and full screen. Feed events may include view, profile visit, club visit, social click, applause, share, and report. Autoplay should be muted by default where browser rules or user expectations require it.

## 8. Club profiles, teams, and claims

Club records include public name, city/state, address, directions data, website/phone where approved, hours, public media, current roster, schedules, and offers. Clubs control only records within their authorized team scope. Team invitations expire and should bind to a role and venue. Sensitive owner, manager, staff, invitation, billing, and audit data is not public.

Legacy or exceptional venue-claim workflows must verify authority before transferring control. A club’s verification of a dancer means only that the club confirms the affiliation represented by the product; it does not mean MyDancr independently guarantees employment status, licensure, hours, conduct, or safety.

## 9. Club Deals and cashier NFC redemption

Club Deals are club-authored, platform-approved admission or line-access benefits. The permitted types are half-off admission and skip-the-line unless counsel and product formally approve another lawful category. Deals may not cover alcoholic drinks, bottle service, controlled substances, gambling, cash, sexual services, or any unlawful or misleading benefit. Deal terms must state eligibility, exclusions, redemption limits, published hours, capacity, age, dress code, and house-rule conditions.

A customer may select a deal from a club page or from an eligible dancer-attributed context. The server creates a redemption token and locks source, club, deal, and any qualifying dancer/shift attribution. At the club, an authorized cashier NFC tag opens or confirms the redemption. The server validates token status, expiry, club and deal match, tag state, duplication rules, and account/session limits. A user interface alone does not verify redemption.

Current fraud controls include a duplicate-use window of 24 hours per customer or anonymous session. NFC tags can be active, disabled, or revoked, and administrators can provision or rotate them. Redemptions and NFC taps retain device/IP or session audit information proportionate to fraud and security needs.

## 10. Referral fees, commissions, club receivables, and payouts

MyDancr maintains two independent finance relationships. First, the club owes MyDancr the referral fee stated in its active club fee term for each eligible verified redemption. Second, MyDancr owes a dancer a reward for an eligible **Profile-Originated Verified Redemption**. A Profile-Originated Verified Redemption is a nonexpired, nonduplicate, nonfraudulent Club Deal redemption successfully confirmed by the correct club’s authorized cashier NFC tag where the immutable server attribution captured before token issuance identifies that dancer’s public profile—including an eligible shift or deal surface presented within that profile—as the originating source. The dancer reward is MyDancr-funded and is not legally conditioned on MyDancr first collecting the club invoice, subject to fraud, reversal, legal hold, or other expressly stated payout conditions.

The dancer’s share is determined by that event’s ordinal among the dancer’s qualifying Profile-Originated Verified Redemptions for the commission month: **events 1–9 earn 30%; events 10–24 earn 40%; and events 25 and above earn 50% of the applicable MyDancr gross referral fee**. The commission month is the calendar month determined in the verified club’s configured local timezone. Tiers are incremental and nonretroactive: reaching a higher tier does not reprice earlier events. The applicable gross referral fee is the fee in the club’s effective fee term—not admission price, deal value, club revenue, tips, or compensation for dancer services. Each event snapshots its monthly ordinal, policy version, applicable gross fee, 3,000-, 4,000-, or 5,000-basis-point dancer share, currency, source profile, deal, club, dancer, shift/context, token, cashier confirmation, and audit data. A club-page-only redemption without dancer-profile attribution creates no dancer reward.

Club referral fees are set by an authorized administrator and require an active fee term before a deal can be published or redeemed. Clubs may request a change, but a request does not modify the effective rate until authorized. Club invoices aggregate verified receivables and preserve item-level redemption support.

Payouts to dancers and, if launched, separately authorized agents must be sent through a separately approved payout provider. MyDancr should store only the provider beneficiary or account identifier, onboarding state, eligibility state, last error, and transfer references, but not full payment-account credentials. The selected provider may collect identity, address, tax, sanctions, source-of-funds, payment-account, device, and transaction data under its own terms. Payees remain responsible for accurate matching information, maintaining an eligible provider account, and fees or taxes allocated to them in the applicable agreement.

## 11. Agent referral model

No agent program should be inferred from a club team role or customer referral. If activated, the agent model should use: an administrator-approved agent record; a written agreement and commission order; Yoti verification appropriate to the agent; verified business, sanctions, and tax status; approved-provider payout readiness; a defined club or transaction attribution; a start/end date; a fixed rate or formula; and an immutable commission event created only after the qualifying verified event.

The model should prohibit commissions for recruiting other agents, impose no purchase or fee to participate, avoid earnings claims, and prevent self-dealing or duplicate attribution. Sponsor/upline language should not be used unless counsel has approved a lawful structure. If an agent helps onboard a club, the club must still independently accept its Club Agreement and fee order.

## 12. Notifications and communications

In-app notifications cover shift postings/updates/cancellations, ranking milestones, approval state, weekly summaries, support messages, video moderation, DMCA, affiliation state, and club-claim state. Optional push is delivered through OneSignal; transactional email is delivered through Resend or Postmark; Supabase may deliver authentication email. Customer preferences include followed dancers/clubs, working tonight, new shifts, schedules, club changes, and cancellations.

Marketing and transactional messages must be classified separately. Marketing email needs compliant sender identity, postal address, and opt-out. Push and any future SMS require appropriate consent, preferences, revocation, and records. Security, account, legal, payout, and support messages may be sent despite marketing opt-out when necessary for the service relationship.

## 13. Reporting, support, moderation, and DMCA

Users can report profiles, clubs, videos, offers, and other supported targets. A report record includes reporter/account or contact context, category, description, target, state, timestamps, and administrative actions. Support uses threads and messages, may use AI-assisted drafting or triage, and escalates to administrators. AI support should not make legal, safety, payout, or approval decisions without authorized review.

DMCA intake collects claimant identity/contact, copyrighted work, location of material, good-faith statement, accuracy/perjury statement, and signature. Counter-notice collects the required statements, consent to jurisdiction, service-of-process acceptance, and signature. Administrative actions include restriction/removal, forwarding, restoration, strikes, and repeat-infringer enforcement. A public designated-agent page is maintained and must match the Copyright Office registration.

## 14. Account deletion, cleanup, and legal retention

An authenticated deletion request marks the account deleted and removes the authentication user. Related profile and ordinary content records may cascade or be cleaned up. Public access should cease promptly. Storage objects must be included in deletion jobs rather than relying only on database cascade. Backups expire on their normal cycle.

Some records cannot be deleted immediately: verified redemptions; invoices; payout and tax records; security/fraud events; moderation and consent evidence; DMCA notices/counters/strikes; support and legal correspondence; club agreements and fee terms; agent orders; and records subject to a legal hold. These retained records should be minimized, access-restricted, and used only for the applicable legal, accounting, security, or dispute purpose.

## 15. Primary systems and external providers

- **Vercel:** application hosting, request and deployment logs.
- **Supabase:** PostgreSQL database, authentication, storage, session and operational services.
- **OpenAI moderation service:** content signals for eligible uploads; human/administrator override remains possible.
- **OneSignal:** optional push notification identifiers, preferences, and delivery events.
- **Resend or Postmark:** transactional email address, message metadata, delivery state, and limited content.
- **Google Maps/directions services:** map or destination requests; direct links may expose data to Google under its terms.
- **Rideshare deep links:** destination and device/browser context sent when the user chooses the link; no implied partnership.
- **Payment processor for club billing:** club billing and invoice payment data, as implemented at launch.
- **Yoti:** identity and age-verification session, ID-document and extracted attribute checks, selfie/liveness and face match where configured, fraud signals, verification report, and configurable retention. Yoti ordinarily acts as a processor/service provider for the requesting organization’s IDV session, subject to its product terms and privacy notice.
- **Approved payout provider, once selected:** beneficiary payment-account onboarding, KYC/AML, account status, payout execution, fees, reserves/holds, failures, transaction history, and compliance. The contracted legal entity, onboarding flow, supported countries, and price schedule must match production.

[CALLOUT:IMPLEMENTATION|Launch synchronization] Before publication, product and counsel must compare this map against production environment variables, processor contracts, database migrations, storage buckets, notification templates, analytics events, and all live pages. Provider names should appear in the privacy policy only when the processor is actually selected and under contract.

[[FLOW_MATRIX]]

# Part II — Draft Terms of Service

## 1. Scope and acceptance

These Terms of Service govern access to MyDancr’s websites, mobile web experience, accounts, public pages, profiles, media feeds, Club Deals, NFC functions, notifications, support, and related services (collectively, the **Service**). “Company,” “MyDancr,” “we,” “us,” or “our” means the legal entity identified in the published version and acceptance record. “User” means any visitor or account holder. Separate Dancer, Club, Agent, Media, Deal, Payout, and other terms apply when a User uses those features. If separate terms conflict with these Terms, the more specific terms govern that feature.

By creating an account, clicking acceptance, uploading content, activating an NFC function, selecting or redeeming a Club Deal, or otherwise using the Service, the User accepts the version presented at that time. Material updates will be presented through reasonable notice and, where required, renewed acceptance.

## 2. Eligibility

A User must be at least 18 years old and legally capable of entering a contract. A club may require a higher age for entry, and nothing in the Service overrides alcohol, gaming, adult-entertainment, employment, work-card, or local licensing laws. Dancers, club representatives, and agents must satisfy the additional verification and authority requirements in their agreements. The Service is unavailable to suspended users, sanctioned persons, or anyone barred by law.

The User represents that signup and account information is accurate, current, and not misleading. Accounts may not be sold, rented, shared outside an authorized club team, or used to impersonate another person or business.

## 3. Account security

The User is responsible for the confidentiality of credentials and for activity under the account, except to the extent caused by Company’s breach of an applicable duty. The User must promptly report unauthorized access. MyDancr may require email confirmation, password reset, reauthentication, identity or authority review, session termination, and other reasonable security measures.

Club owners and managers are responsible for assigning least-privilege team roles, removing former staff, and protecting access codes, invitations, and NFC tags. A dancer must not let another person use the dancer account or verification token.

## 4. What MyDancr provides

MyDancr provides technology for lawful public discovery, promotional profiles and media, club information, venue-confirmed affiliations, schedules, directions, allowed Club Deals, NFC verification, engagement analytics, reporting, and referral attribution. Content and availability can change without notice. A profile, badge, status, ranking, club affiliation, or verification signal is limited to the specific checks described in the Service and is not a guarantee of identity, employment, licensing, conduct, availability, safety, quality, or willingness to interact.

MyDancr is not a party to club admission decisions, dancer-club employment or independent-contractor arrangements, interactions inside a club, transportation, third-party social media, or any prohibited off-platform transaction. MyDancr does not arrange or process payment for private dances, sexual services, escorting, prostitution, companionship, or other personal services.

## 5. Public content and user content

Public pages may display stage names, city, approved media, social links, club affiliations, schedule status, engagement signals, and deal information. Users retain ownership of content they submit but grant the license in the Content and Media Consent/License. Users may submit only content they have the right and documented consent to use.

MyDancr may transform, crop, transcode, resize, watermark, moderate, classify, remove, restrict, preserve, or decline content as described in the policies. Approval is not an endorsement and does not waive future enforcement.

## 6. Club Deals, NFC, and attribution

Club Deals are conditional club offers, not cash, stored value, reservations, tickets, or guaranteed admission. The club controls admission and must honor a valid deal subject to disclosed limits, capacity, age, dress code, safety, hours, and law. A deal is verified only through the authorized server and cashier NFC flow. Screenshots, copied tokens, expired links, or unconfirmed selections are invalid.

Attribution may record the club page, dancer profile, shift, deal, session, and NFC confirmation that led to a verified redemption. MyDancr may use this attribution to invoice clubs and calculate rewards. Users may not manipulate source attribution, create duplicate redemptions, simulate taps, or interfere with tags.

## 7. Payments and payouts

Customer use of a Club Deal does not authorize MyDancr to charge the customer unless a separate purchase flow clearly states a charge. Clubs may owe contractual referral fees and subscription or service charges. Under the current Dancer Commission Terms, a Profile-Originated Verified Redemption earns the attributed dancer 30%, 40%, or 50% of the applicable MyDancr gross referral fee according to whether it is the dancer’s 1st–9th, 10th–24th, or 25th-and-later qualifying event in the commission month; the detailed attribution, exclusions, correction, and payout rules control. Authorized agents may receive commissions only under a separate written order. Live commission payouts require a separately approved payout provider and an eligible provider account. Club billing may use a different payment processor. Each financial provider is subject to availability, eligibility, compliance review, and its own terms.

MyDancr may delay or withhold a payout during a reasonable investigation of fraud, sanctions, duplicate attribution, legal process, processor review, chargeback, mistake, or policy violation. MyDancr will not withhold an undisputed earned amount solely because a club is late paying an independent club invoice where the applicable commission terms state the reward is Company-funded.

## 8. Acceptable use

The Acceptable Use and Prohibited Conduct Rules are incorporated. Without limitation, Users may not use the Service for minors, trafficking, prostitution, sexual-service solicitation, nonconsensual intimate imagery, unlawful discrimination, violence, drugs, weapons, alcohol offers, fraud, harassment, stalking, doxxing, infringement, malicious code, scraping, credential abuse, or interference with security, NFC, ranking, moderation, or finance systems.

## 9. Third-party services

Links and integrations may lead to clubs, social networks, maps, rideshare providers, authentication/email/push providers, Yoti, an approved payout provider once selected, and the club billing processor. Third parties control their own services, terms, availability, and data practices. A link or technical integration does not imply endorsement or partnership. The User is responsible for reviewing third-party terms.

## 10. Changes and availability

MyDancr may modify, suspend, or discontinue a feature for security, legal, provider, operational, or product reasons. MyDancr will give notice when required and will not retroactively eliminate an earned, undisputed commission except as allowed by the applicable commission terms. Maintenance, networks, devices, browsers, clubs, providers, and events beyond MyDancr’s control may affect availability.

## 11. Reports, enforcement, and appeals

MyDancr may investigate reports, preserve evidence, restrict content, disable features, suspend accounts, terminate access, revoke tags, void fraudulent redemptions, and notify affected parties or authorities as permitted or required. The Moderation, Reporting, Suspension, and Appeals Policy describes ordinary review. Immediate action may occur for safety, minors, trafficking, credible threats, fraud, sanctions, legal process, or system integrity.

## 12. Intellectual property and DMCA

MyDancr’s software, design, marks, graphics, rankings, documentation, and non-user content are owned by Company or its licensors. No rights are granted except the limited right to use the Service under these Terms. Copyright complaints and counter-notices follow the DMCA and Takedown Policy. Repeat infringers may be terminated in appropriate circumstances.

## 13. Privacy

The Privacy Policy explains collection, use, disclosure, retention, rights, and choices. Users must not collect, export, or misuse another person’s data from the Service. Clubs and agents that separately determine a purpose for personal information are responsible for their own privacy compliance.

## 14. Disclaimers

To the maximum extent permitted by law, the Service is provided “as is” and “as available.” MyDancr does not warrant uninterrupted operation; particular rankings, earnings, attendance, admissions, availability, reach, or business outcomes; the accuracy of user- or club-supplied information; or conduct of a User or third party. MyDancr does not provide legal, tax, employment, licensing, safety, transportation, or financial advice.

Nothing in these Terms excludes a warranty or remedy that cannot lawfully be excluded. Users should contact emergency services, the club, or appropriate authorities—not app support—for emergencies.

## 15. Limitation of liability

The published version should contain counsel-approved exclusions and a liability cap appropriate to consumer law and the separate commercial agreements. It should distinguish direct platform claims from interactions at clubs, user content, transportation, third-party services, lost profits, and unauthorized conduct. Any cap should preserve nonwaivable rights and address whether club and agent agreements use a different negotiated cap.

[CALLOUT:COUNSEL|Liability clause required] Insert the final dollar or fee-based cap, exclusions, exceptions, and state-specific savings language only after insurance, entity, and launch-jurisdiction review. Do not publish a generic copied cap.

## 16. Indemnity

Dancers, clubs, and agents should indemnify Company for third-party claims arising from their content, authority, agreements, unlawful conduct, licensing failures, offers, marketing statements, tax obligations, or breach, subject to counsel-approved procedure and applicable law. Consumer indemnity should be narrowed to lawful scope and should not shift Company’s own negligence or statutory obligations.

## 17. Termination

The User may stop using the Service and may disable or request deletion of an account. MyDancr may suspend or terminate for breach, risk, legal process, nonpayment, provider restrictions, or discontinued service. Clauses that by nature should survive—including accrued payment duties, licenses necessary for retained legal records, disclaimers, limitations, dispute terms, and enforcement records—survive.

## 18. Governing law and disputes

The final Terms must identify governing law, judicial venue or arbitration administrator/rules, class and jury waivers if used, small-claims rights, consumer-law savings, notice address, and any opt-out period. Commercial Club and Agent Agreements may use different negotiated dispute terms.

[CALLOUT:DECISION|Do not publish yet] Dispute provisions materially affect user rights and enforceability. Counsel must draft them for MyDancr’s entity, states served, acceptance UI, and consumer/commercial segmentation.

## 19. General

The published Terms should include assignment, force majeure, waiver, severability, electronic communications, notices, entire agreement, order of precedence, interpretation, and contact provisions. MyDancr may assign to an affiliate or successor as permitted by law; Users may not assign without consent. Failure to enforce is not a waiver.

---PAGE---

# Part III — Draft Privacy Policy

## 1. Scope

This Privacy Policy applies to personal information processed by MyDancr through the Service. Yoti processes identity-verification data for requested sessions under its product privacy notice and contract with MyDancr. Any payout provider selected in the future will process beneficiary and payment-account data under its own terms and privacy notice. This policy does not govern independent club practices, third-party social sites, maps, rideshare providers, or providers acting independently. The published version must identify the MyDancr controller/business legal entity and contact methods.

## 2. Information collected

### Account and contact data

Email address, authentication identifiers, role, display name, account state, city, confirmation and recovery status, security events, and communications. Passwords are processed by the authentication service and should not be available to Company personnel in plain text.

### Dancer profile and verification data

Stage name, city, bio, avatar, profile photos, videos, social links, public slug, visibility, status, legal identity or verification readiness, club affiliations, verification events, work-card or license information if required, and consent/acceptance records. A Yoti session may process an identity document and available fields such as legal name, date of birth, address, document number/type, nationality, issue/expiry dates, gender where present, and document photo; selfie/liveness, biometric face match, document-authenticity, fraud, watchlist, or other configured checks; and a report returned to MyDancr. Legal identity and verification evidence are private and should not appear on the public profile.

### Club and team data

Club name, address, location coordinates, contact information, hours, website, public media, offers, team members, owner/manager/staff role, access code/invitation/claim data, authority evidence, NFC tag assignments, fee terms, invoices, and activity logs.

### Customer preferences and activity

City, followed dancers and clubs, favorites, going signals, saved deals, notification settings, profile/schedule/club/video views, directions, social clicks, shares, applause, and deal activity. Some actions may use a pseudonymous browser/session token when the user is not signed in.

### Media and moderation data

Original uploads, transformed versions, thumbnails, technical metadata, duration/dimensions, storage paths, hashes, moderation inputs/outputs, reason codes, reviewer actions, reports, and watermarks. MyDancr should avoid retaining unnecessary camera metadata or location embedded in media.

### Location, NFC, device, and security data

For an eligible dancer check-in, latitude, longitude, accuracy, reading time, distance result, club, and verification expiry. For NFC and security events: tag/token digest, timestamp, club, browser session, device fingerprint or attributes, IP address, user agent, and audit payload. Public users do not receive raw dancer location.

### Finance, commission, tax, and payout data

Club fee terms, invoices, invoice items, payment status/references, verified redemption data, gross referral fee, dancer share, platform share, policy version, commission status, payout batches/items, provider beneficiary or account identifier, onboarding/eligibility state, failure reason, transfer reference, tax classification/documents or status, and agent order/attribution if an agent program is active. Full provider credentials, ID images collected solely for payment-account KYC, and external bank/card credentials should remain with the approved provider rather than being copied into MyDancr’s ordinary database.

### Support, reports, legal, and DMCA data

Support threads/messages, reachable recovery email, report category and narrative, administrative actions, DMCA notice/counter-notice fields, strikes, correspondence, law-enforcement/legal requests, and preservation holds.

### Cookies and similar technologies

Session cookies, local storage, CSRF/security tokens, preference values, anonymous attribution tokens, and provider SDK identifiers. The published cookie notice must identify any analytics/advertising technology actually in production. Essential storage supports authentication, security, preference, and redemption integrity.

## 3. Sources

Information comes from the User; clubs and authorized team members; dancers; agents under contract; automated device/browser events; NFC tags; content moderation; Yoti verification reports; an approved payout provider once selected; the club billing processor; authentication, hosting, email, push, map, and support vendors; public sources used for club verification; other Users’ reports; and authorities where lawful.

## 4. Purposes

- Create, authenticate, secure, recover, and administer accounts.
- Render public dancer, club, schedule, deal, and video experiences.
- Verify identity readiness, club authority, dancer affiliation, and time-limited presence.
- Process uploads, transformations, moderation, publication, reporting, and takedown.
- Personalize city results, follows, saved content, notifications, and rankings.
- Provide directions and user-requested external links.
- Create, validate, and prevent abuse of Club Deal redemptions and NFC tags.
- Invoice clubs, calculate commissions, process payouts, reconcile failures, and meet tax/accounting duties.
- Provide support, recovery, appeals, legal notices, and DMCA processes.
- Prevent fraud, exploitation, trafficking, minors’ access, security attacks, and prohibited conduct.
- Enforce agreements, protect rights and safety, defend claims, and comply with law.
- Develop and improve the Service using aggregated, deidentified, or access-controlled information.

## 5. Disclosures

MyDancr may disclose data to vendors acting under contract for hosting/database/storage/authentication, content moderation, push, email, maps, support, security, club payment processing, payout processing, and professional services. The minimum data necessary should be disclosed for the function.

Public profile data is disclosed to visitors. A club receives information necessary to review its dancer affiliations, team, offers, verified redemptions, and invoices, but not private dancer payout rates or customer contact details unless separately authorized by law and product design. A dancer receives the dancer’s own profile, activity, affiliations, commissions, and payouts, but not customer identity. An agent receives only the agent’s authorized attribution and compensation records, not unrelated club, dancer, or customer data.

MyDancr may disclose information in a merger, financing, acquisition, reorganization, or asset transfer subject to appropriate protections; to professional advisers; to authorities or parties when reasonably necessary for law, safety, fraud, trafficking, child protection, rights, or legal claims; and with the User’s direction or consent.

MyDancr should state whether it “sells” or “shares” personal information under applicable state definitions only after a production vendor/data-use review. Contractual service-provider disclosure does not automatically answer that statutory question.

## 6. Yoti identity and age verification

MyDancr directs an eligible dancer and, where required, a club representative or agent to a Yoti verification session. Depending on configuration, Yoti may collect an identity document, extracted attributes, a selfie, liveness and face-match data, fraud signals, and optional watchlist or address checks, then provide MyDancr with a report. Yoti states that it ordinarily acts as the service provider/processor for its client in a standard identity-verification session; MyDancr remains responsible for the verification purpose, lawful basis, notices, configuration, retention, access decisions, and response to rights requests concerning data MyDancr receives.

MyDancr should configure Yoti to return and retain only necessary attributes, set the shortest workable time-to-live, limit portal access, and document any downloaded report. Where biometric information is processed, MyDancr must present any required state-specific notice and consent and provide any legally required alternative. Yoti’s terms require public references to identify Yoti as the provider or use “powered by Yoti,” subject to the contracted brand rules.

## 7. Commission payout provider

Live payouts remain disabled until MyDancr selects a legally and contractually approved payout provider. To receive a payout after activation, a dancer or authorized agent must establish and maintain an eligible provider account. The provider may collect legal name, date of birth, address, business information, tax information, government identification, identity-verification data, sanctions/KYC information, source-of-funds information, external account details, device/security data, and transaction data under its own terms and privacy policy. MyDancr may exchange payee identifier, contact information, amount, currency, payment purpose, statement/reference, status, and compliance or failure results needed to execute and reconcile commissions. Provider approval, restrictions, reserves, fees, account closure, and supported payment methods are independently controlled by that provider.

The published policy must identify the selected provider’s contracted legal entity and link to its exact production privacy notice and terms before any live payout data is sent. MyDancr must update the notice and contract/vendor record before changing providers or sending materially different data.

## 8. Choices and rights

Users can edit supported profile and preference fields, control marketing and optional notifications, unfollow, remove content subject to legal retention, disable visibility where supported, and request access, correction, deletion, or appeal through the designated address. Nevada consumers may submit a verified request regarding covered-information sale as applicable. Residents of other states or countries may have additional rights.

Identity verification may be required before fulfilling a request. MyDancr should not provide data that would disclose another person’s information, undermine security/fraud systems, or violate legal retention. Authorized-agent requests require proof of authority. Appeals and response deadlines must follow applicable law.

## 9. Retention

MyDancr retains data only as long as reasonably necessary for the stated purposes, contracts, security, disputes, tax/accounting, DMCA, fraud, and law. The separate retention policy describes proposed periods by class. Public content is removed or restricted when no longer eligible, while minimum audit or finance facts may remain. Backups are isolated and expire through the backup cycle.

## 10. Security

Controls include managed authentication, encrypted transport, provider-managed encryption at rest, role and row-level access, private review storage, signed tokens, secret hashing, rate limits, server-side validation, least privilege, administrative audit, tag lifecycle, environment-secret management, and monitoring. No system is completely secure. The published policy must provide a security contact and an incident/breach process aligned with applicable notice law.

## 11. Minors

The Service is intended only for adults and does not knowingly permit anyone under 18 to create an account or appear in content. Suspected minor-related content or access should be immediately restricted and escalated under the safety policy. A parent, guardian, or authority may contact the designated safety address.

## 12. International processing

Providers and users may be located in different jurisdictions. If MyDancr serves users outside the United States or sends data internationally, counsel must approve transfer mechanisms, controller/processor terms, localization rules, and rights notices before launch in that jurisdiction.

## 13. Changes and contact

The published policy will state effective and updated dates, material-change notice, privacy request methods, appeal method, and the entity’s address. A version history and acceptance/notice record should be maintained.

---PAGE---

# Part IV — Draft Dancer Agreement

## 1. Relationship and scope

This Dancer Agreement supplements the Terms for a person who creates a dancer account, submits a public professional profile, uses venue verification, posts shifts, uploads media, or receives commissions. It governs only the relationship with MyDancr. It does not create employment, partnership, agency, fiduciary duty, franchise, joint venture, or club engagement.

The dancer is responsible for the dancer’s own relationship with each club, including classification, pay, tips, fees, scheduling, taxes, licensing, work cards, safety, and conduct. MyDancr does not direct the dancer’s performance work, set service prices, collect payment for dancer services, or guarantee customers, shifts, income, or admission.

## 2. Eligibility and truthful identity

The dancer represents that the dancer is at least 18, is the person operating the account, has legal capacity, and may lawfully work and publish the submitted content. The dancer must provide accurate identity and city information, complete the required Yoti session, and must not use another person’s documents, likeness, stage identity, or account. A stage name may be public; legal identity remains private except as required for Yoti verification, tax, an approved payout provider, safety, or law.

The dancer must maintain all local work cards, entertainer licenses, permits, immigration/work authorization, and club requirements. A MyDancr badge or affiliation does not replace government or club verification.

## 3. Initial approval and affiliations

Before the profile becomes public, the dancer must complete the required Yoti age/identity check, complete required profile fields, obtain approval of required media, submit the profile, and complete first club verification through the approved flow. A Yoti result supports identity and age assurance but is not a guarantee; a club confirmation verifies only the represented affiliation. MyDancr may require additional review or decline publication.

After approval, the dancer may add or change affiliations only through the approved process. The dancer may post a shift only for an active approved affiliation and may not claim a club where the dancer is not authorized to work. The dancer must promptly remove or update an inaccurate affiliation or schedule.

## 4. Working Now and presence data

Working Now may require an approved dressing-room NFC tap or other server-validated presence check. The dancer authorizes collection of limited tag, timestamp, device/IP, and—when used—proximity data to validate the event, prevent fraud, operate the time window, and attribute eligible redemptions. The dancer may not share tags, simulate taps, alter device time/location, use automation, or ask another person to check in.

Working Now is time-limited and does not promise that the dancer remains continuously on premises or available to any customer. The dancer should end an inaccurate status through available controls and notify support of a malfunction.

## 5. Profile and media obligations

The dancer grants the Content and Media License and represents that each upload depicts consenting adults, is owned or properly licensed, is not misleading, and complies with club, privacy, intellectual-property, and safety rules. The dancer must obtain releases from every recognizable person and location owner where required. The dancer must not upload hidden-camera, nonconsensual, trafficked, minor, infringing, or illegal content.

The dancer understands that media may be automatically and/or manually reviewed, transformed, watermarked, resized, transcoded, rejected, or later removed. Approval is not a legal clearance. The dancer remains responsible for rights and records.

## 6. Social links and off-platform conduct

Supported social links may be displayed as “Social links” or equivalent neutral wording. The dancer must control or be authorized to link each account. Links may not be used to evade MyDancr rules, solicit prohibited services, direct minors, mislead customers, or distribute malware. Third-party platform terms apply.

MyDancr does not monitor all off-platform conduct, but conduct connected to the Service may support enforcement when it creates safety, fraud, trafficking, impersonation, or legal risk.

## 7. Commissions and payout

The dancer earns a reward only from a Profile-Originated Verified Redemption: an eligible Club Deal redemption that the server validly attributes to a customer journey originating from that dancer’s public profile, including an eligible shift or deal surface presented within the profile, and that the correct club’s authorized cashier NFC tag successfully confirms. A profile view, social click, follow, unverified selection, screenshot, failed or duplicate NFC event, demo record, ordinary club attendance, or club-page-only redemption without dancer-profile attribution does not earn commission.

For every Profile-Originated Verified Redemption, the dancer receives **30% for qualifying monthly events 1–9, 40% for events 10–24, and 50% for events 25 and above** of the applicable MyDancr gross referral fee. The percentage does not apply to the customer’s admission value, the deal’s face value, club revenue, tips, or any dancer service. Each event is priced using its ordinal at confirmation and is not retroactively repriced when a later event reaches a higher tier. The event must preserve the source profile, commission month, ordinal, policy version, 3,000-, 4,000-, or 5,000-basis-point share, gross referral fee, currency, club, deal, dancer, token, cashier confirmation, and timestamps. MyDancr may prospectively amend the compensation policy only through clear advance notice and renewed acceptance where required; accrued events keep their snapshot unless corrected for error, fraud, reversal, illegality, sanctions, or a genuine attribution dispute.

After MyDancr selects and activates an approved payout provider, the dancer must open and maintain an eligible provider account, complete the provider’s KYC and tax/compliance checks, maintain information matching the MyDancr payee record, and remain eligible. The dancer authorizes MyDancr to send commission payout instructions and required transaction/payee data to that provider. Provider fees, foreign exchange, limits, supported countries, reserves, payment-method availability, compliance review, and holds may apply as disclosed. MyDancr does not control the provider’s independent approval or account decisions.

MyDancr may hold a disputed amount during a documented investigation, offset an overpayment or fraudulent/reversed event as permitted by law, and require updated tax information. Undisputed earned dancer rewards are not conditioned solely on club invoice collection. The dancer is responsible for taxes and for seeking professional advice.

[CALLOUT:COUNSEL|Payout schedule] Add the approved payout frequency, minimum, reserve/hold period, statement dispute deadline, returned-payment process, inactivity/unclaimed-property rule, fee allocation, tax forms, and final-payment timing before launch.

## 8. Independent activity and safety

The dancer chooses whether and when to use the Service and whether to work at a club, subject to the dancer’s separate club obligations. Nothing requires the dancer to accept contact, perform, disclose legal identity publicly, or remain visible. The dancer may use incognito/visibility controls where available.

The dancer should use club security and emergency services for immediate safety. App support is not an emergency service. The dancer must report suspected trafficking, coercion, minor involvement, impersonation, or nonconsensual media promptly.

## 9. Enforcement and termination

MyDancr may pause onboarding, restrict media, remove an affiliation, stop a Working Now state, suspend payouts, or disable the profile for verification failure, inaccurate schedules, tag abuse, prohibited content, fraud, sanctions, legal process, safety, or breach. Ordinary appeals follow the enforcement policy. Immediate restriction may precede notice where necessary.

On termination, public access ends, but accrued undisputed obligations and legally required records survive. The license ends for ordinary future promotion after removal, but continues as necessary for existing shared materials, technical backups, evidence, legal compliance, and defense of claims.

## 10. Dancer acknowledgments

The dancer acknowledges the customer-facing limits of badges and status, the absence of guaranteed earnings, the role of club admission and independent club rules, Yoti’s verification role, the future approved payout provider’s commission-payout role, the public nature of approved profile content, dynamic ranking signals, and the separate Content/Media, Acceptable Use, Verification, Commission, Moderation, Privacy, and Retention policies.

---PAGE---

# Part V — Draft Club Agreement

## 1. Authority and account

The person accepting for a club represents authority to bind the legal operator identified in the club order/acceptance record. The club must provide accurate legal, licensing, location, contact, tax, and payment information. Access codes and invitations are single-purpose security credentials and may not be transferred. The club is responsible for owner, manager, and staff activity within granted permissions.

## 2. Independent businesses

The club and MyDancr are independent contractors. MyDancr does not operate the club, employ or supply dancers, control admission, supervise club workers, sell alcohol, provide security, or guarantee attendance. The club is solely responsible for premises, licenses, age checks, work cards, employment/classification, wage/tip/fee practices, alcohol, gaming, safety, accessibility, taxes, and house rules.

## 3. Public club information

The club authorizes MyDancr to display approved club name, address, location, hours, directions, website/phone, public media, roster/affiliations, schedules, Club Deals, and other submitted information. The club must keep it accurate and must have rights to submitted marks and media. MyDancr may standardize presentation and remove inaccurate or noncompliant content.

## 4. Dancer affiliation verification

Only an authorized club representative may confirm a dancer affiliation. The representative must reasonably compare the dancer, stage name, and avatar presented through the secure workflow and must not approve a person the representative cannot identify as legitimately affiliated. Confirmation does not transfer the club’s legal verification, licensing, employment, or safety duties to MyDancr.

The club must promptly end an affiliation that is no longer accurate and respond to disputes. It may not use affiliation review to retaliate unlawfully, misrepresent employment, obtain private payout information, or control unrelated dancer content.

## 5. NFC tags

Dressing-room and cashier tags remain Company-controlled credentials even when installed at the club. The club must install each tag only at the approved location, restrict staff access, prevent copying or relocation, inspect for tampering, and report loss or compromise immediately. The club may not create lookalike tags, rewrite tokens, collect credentials, or bypass server confirmation.

The club authorizes collection of tap, device/IP, tag, venue, timing, and fraud data necessary to operate affiliation, presence, and redemption. MyDancr may disable or rotate a tag for security, misuse, termination, or maintenance.

## 6. Club Deals

The club may publish only approved admission or line-access offers. Each deal must be truthful, available on disclosed terms, and honored when valid, subject only to clearly disclosed capacity, age, dress code, hours, safety, and house rules. The club may not publish alcohol, drink, bottle-service, sexual-service, cash, gambling, controlled-substance, or unlawful offers.

The club is the offeror and bears responsibility for consumer disclosures, fulfillment, staff training, and lawful refusal. MyDancr may review or remove a deal but does not become the offeror.

## 7. Referral fees and invoices

For each eligible server-verified redemption, the club owes the referral fee in the active fee term/order. A requested fee change is ineffective until accepted by authorized MyDancr personnel. When the locked source qualifies as a dancer’s public profile, MyDancr separately credits that dancer the applicable 30%, 40%, or 50% monthly tier share of the MyDancr gross referral fee under the Dancer Commission Terms. That credit does not reduce, offset, or condition the club’s referral-fee obligation. Invoice items identify supporting redemptions without exposing unnecessary dancer payout-account information. Club payment duties are separate from MyDancr’s dancer rewards.

The club must review statements and raise a specific good-faith dispute within the approved period. Undisputed amounts remain due. The final order should state invoice cycle, due date, payment method, taxes, late fee/interest within lawful limits, failed-payment costs, and suspension rights.

## 8. Team and security

The club must grant least privilege, promptly revoke departed personnel, maintain accurate owner/manager/staff roles, secure email accounts and devices, and review activity. The club is responsible for acts of authorized team members. Suspected compromise must be reported immediately.

## 9. Compliance and prohibited conduct

The club will maintain all adult-entertainment, cabaret, liquor, fire, occupancy, employment, tax, accessibility, and other licenses and comply with anti-trafficking, age, wage, discrimination, privacy, advertising, and consumer laws. The club will not use MyDancr to arrange prostitution, sexual services, unlawful contact, worker coercion, kickbacks, or retaliation.

## 10. Data and confidentiality

The club may use MyDancr data only to operate authorized club features. It may not build customer lists from anonymous signals, export dancer/customer data, sell data, scrape, reidentify, or use payout/engagement information for discriminatory or retaliatory purposes. Confidential information includes security architecture, tag credentials, fee terms where designated, nonpublic user data, and incident information.

## 11. Suspension and termination

MyDancr may suspend club publishing, deals, tags, team access, or account access for nonpayment, licensing concerns, unsafe or deceptive conduct, tag abuse, fraud, security, legal process, or breach. The club remains responsible for accrued fees, valid consumer commitments, and return/destruction of credentials. Public data may be retained as historical/legal records but should not suggest an active relationship after termination.

## 12. Commercial protections

The final Club Agreement should include negotiated confidentiality, security cooperation, insurance, audit of redemption disputes, warranties, mutual or allocated indemnities, liability cap, term/renewal, termination, governing law, notices, assignment, force majeure, and order-form precedence.

[CALLOUT:COUNSEL|Club order form] Attach a venue-specific order containing legal operator, DBA, licensed premises, authorized signer, subscription/services, referral fee, currency, invoice cycle, due date, tax handling, processor, term, renewal, and special compliance conditions.

---PAGE---

# Part VI — Draft Content and Media Consent/License

## 1. Covered content

“Content” includes profile fields, stage name, biography, avatar, photos, videos, audio, thumbnails, logos, club media, social links, captions or labels created by the Service, offer materials, reports, and other material submitted, linked, or authorized for publication.

## 2. Ownership and authority

The submitter retains ownership of original Content. The submitter represents and warrants that the submitter owns or has sufficient written rights, permissions, model releases, location/property releases, music/sound rights, trademark permissions, and privacy/publicity consents for MyDancr’s uses. Every depicted person must be an adult and must have knowingly consented to creation and distribution in the intended context.

The submitter must preserve underlying releases and age/identity records for the period required by law and provide reasonable evidence to MyDancr or authorities where legally necessary. MyDancr’s approval is not a substitute for those records.

## 3. License to MyDancr

The submitter grants Company a nonexclusive, worldwide, royalty-free, sublicensable-to-service-providers, transferable-with-the-Service license to host, store, reproduce, format, crop, resize, transcode, compress, stream, watermark, display, perform, distribute, and make technical derivatives of Content to operate, secure, moderate, promote, and improve the Service and to comply with law. Promotional use outside the submitter’s ordinary profile/feed context should require the consent scope approved by counsel and, where appropriate, a separate release.

The license continues while Content is published and for a reasonable wind-down, cached/shared copy, backup, audit, dispute, moderation, DMCA, safety, and legal-compliance period. Deletion ends new ordinary promotional use after processing, but cannot retract a copy lawfully shared by another user or retained for legal purposes.

## 4. Name, likeness, and voice

The dancer authorizes use of the approved stage name, likeness, appearance, performance, and voice within the Service and associated Service promotion within the accepted scope. Legal name is not public unless the dancer separately directs and counsel approves. No license authorizes creating an endorsement the dancer did not make or materially altering Content to misrepresent conduct.

## 5. Moderation and technical processing

The submitter consents to automated and human analysis for safety, nudity/sexual-content classification, age-risk, violence, drugs, text, logos, fraud, and policy compliance; to secure transmission to contracted moderation providers; and to administrative review. Decisions can be wrong. The submitter may use the appeal process but may not demand publication.

## 6. Prohibited content

Content may not include a minor; a person who did not consent; trafficking or coercion; hidden-camera or intimate material; actual sexual-service solicitation; unlawful sexual conduct; extreme violence; controlled substances or weapons promotion; hate or harassment; personal data exposed without authority; infringement; deceptive synthetic media; malware; or material otherwise prohibited by policy.

## 7. Music and third-party material

The submitter must not assume that music playing in a club, a social-platform license, or ownership of a recording grants synchronization or public-performance rights on MyDancr. MyDancr may mute, reject, or remove audio and should maintain a rights-cleared audio strategy before scaling video.

## 8. AI and synthetic media

The submitter must disclose materially synthetic or altered depictions and must not use AI to impersonate a real person, falsify club presence, evade moderation, or depict a minor or nonconsensual intimate content. The final policy should state whether MyDancr uses Content to train proprietary models; absent a clear opt-in and approved notice, this draft does not grant a training right.

## 9. 2257/2257A review

MyDancr’s current intended public policy excludes actual sexually explicit conduct. If any production or publication could fall within 18 U.S.C. §§ 2257 or 2257A, counsel must determine producer status, records, labels, custodian, inspections, and downstream obligations before accepting that category. A generic “18+” checkbox is not a substitute.

## 10. Removal and preservation

MyDancr may remove or preserve Content for policy, safety, rights, legal process, fraud, or technical reasons. Where lawful, MyDancr may retain a cryptographic hash, moderation decision, report, consent/acceptance record, and restricted evidentiary copy to prevent reupload or defend claims.

---PAGE---

# Part VII — Draft Acceptable Use and Prohibited Conduct Rules

## 1. Safety and adults only

Users may not access or use the Service if under 18; depict, identify, target, groom, solicit, exploit, or endanger a minor; misstate age; evade age or identity controls; upload child sexual abuse material; or fail to report a suspected minor or exploitation concern through available safety channels.

## 2. No prostitution, trafficking, or sexual-service facilitation

Users may not offer, request, price, negotiate, arrange, advertise, transport for, pay for, or facilitate prostitution, escorting, sexual contact, sex acts, or private sexual services; use coded language, social links, profiles, shifts, deals, media, or support to do so; traffic, coerce, threaten, recruit, harbor, or control another person; or retaliate against a person who raises a concern.

## 3. Consent and privacy

Users may not upload or distribute nonconsensual intimate imagery, hidden-camera material, doxxing, private contact/identity data, location, financial data, verification documents, or another person’s communications without authority. Stalking, surveillance, harassment, unwanted contact, and attempts to reidentify anonymous users are prohibited.

## 4. Truthful profiles, clubs, and schedules

Users may not impersonate; create duplicate accounts to evade enforcement; falsify stage name, identity, club authority, affiliation, shift, location, badge, ranking, endorsement, or availability; misrepresent licensing; or use another person’s avatar/media. Clubs may not approve a false affiliation. Dancers may not post shifts for unapproved clubs.

## 5. Content rules

Users may not submit infringing, unlawful, exploitative, deceptive, hateful, threatening, graphically violent, self-harm-promoting, drug-selling, weapon-selling, malware, spam, or fraudulent content. Content must not include actual sexual conduct or other categories barred by the current media standard.

## 6. Club Deal rules

Users may not publish or redeem offers for alcohol, drinks, bottle service, cash, cash equivalents, gambling, controlled substances, weapons, sexual services, or unlawful activity. Users may not duplicate, resell, transfer, screenshot to counterfeit, automate, alter, or falsely confirm a redemption. Clubs must not refuse a valid offer for an undisclosed discriminatory or deceptive reason.

## 7. NFC and technical integrity

Users may not copy, move, rewrite, obscure, damage, replace, emulate, relay, or reverse engineer an NFC tag; simulate a tap; manipulate location/time/device/session data; bypass rate limits; scrape; credential-stuff; probe vulnerabilities without authorization; introduce malicious code; interfere with availability; or access data outside assigned permissions.

## 8. Finance and referral integrity

Users may not create sham redemptions, self-deal, collude, recycle sessions, falsify invoices/payout accounts/tax data, redirect attribution, claim an unauthorized agent relationship, make deceptive earnings claims, recruit a downline, charge participation fees, or use payouts for unlawful activity. Mistaken payments must be reported and returned as permitted by law.

## 9. Conduct in and around clubs

MyDancr does not control club conduct, but Users may not use the Service in connection with violence, threats, discriminatory harassment, coercion, unlawful recording, property damage, intoxicated driving, or evasion of club safety and entry rules. “Going,” “Working Now,” and follows are informational signals, not invitations or consent.

## 10. Enforcement

Violations may result in content restriction, warning, feature limitation, removal of affiliation/status, voided redemptions, tag revocation, payout hold, suspension, termination, evidence preservation, and referral to providers or authorities. MyDancr may consider severity, intent, history, harm, cooperation, and risk. Appeals do not require reinstatement during an active safety or fraud risk.

---PAGE---

# Part VIII — Draft Age, Identity, and Venue-Verification Policy

## 1. Adult eligibility

All Users must be at least 18. A club may require 21 or another lawful higher age for entry. Dancers must also meet the legal age and licensing requirements for work at the specific club and jurisdiction. The Service must not imply that account eligibility equals club eligibility.

## 2. Risk-based verification

Verification should be proportionate to role and action. Email confirmation is appropriate for basic account access but is not enough for a public dancer, club owner, authorized manager, payout recipient, or agent. High-risk roles require a configured Yoti check and/or other documented authority review. The selected approved payout provider will separately control payment-account KYC for payout recipients.

## 3. Dancer identity

Before public approval, the dancer must complete a Yoti Identity Verification session configured to obtain the minimum necessary legal identity and date-of-birth result; complete document-authenticity, selfie/liveness, biometric face match, anti-spoofing or fraud checks selected by MyDancr; provide an avatar that can be compared to the person where appropriate; and meet media and venue gates. Public display uses stage name unless disclosure is legally required.

Yoti evidence and reports must be encrypted and access-restricted and must not be exposed to clubs beyond the minimum confirmation interface. MyDancr should record the Yoti session/reference, check configuration, result, dates, and decision—not unnecessary document or selfie copies—unless counsel requires retention. Yoti portal time-to-live and deletion settings must match the approved retention schedule. Any biometric notice/consent and alternative method required by applicable U.S. state law must be presented before collection.

## 4. Club authority

A club owner or manager must establish authority through an administrator-issued code, invitation, licensing/business records, domain/contact confirmation, or other approved evidence. Team members receive scoped roles. A staff account cannot bind the club or access owner-only finance unless expressly authorized.

## 5. Initial venue gate

A first-time dancer’s profile remains private until an authorized club confirms a legitimate affiliation using the secure verification flow. The club should compare the stage name and avatar and attest to authority and accuracy. MyDancr then applies the remaining eligibility rules. Venue confirmation alone does not approve rejected media or an incomplete identity.

## 6. Later affiliations and shifts

An approved dancer may add or switch affiliations through the dashboard, but the new club must independently approve. Only active approved affiliations appear in the shift venue selector. Ending an affiliation prevents future shifts and Working Now at that club but does not erase historical finance or legal records.

## 7. NFC assurance

NFC tags are scoped by type and club. Dressing-room tags support affiliation/presence; cashier tags support deal verification. Tokens are secret or hashed, tags have lifecycle states, and server confirmation is required. Tags should be installed in controlled areas and rotated on compromise.

## 8. Payout and agent verification

Payout recipients must complete the selected approved provider’s onboarding and any MyDancr tax, sanctions, identity, and account-matching checks. MyDancr may rely on Yoti for platform identity and on the selected provider for payment-account KYC, but must resolve mismatches before payout. An agent must also have a valid separate agreement and order. Provider approval does not itself authorize a MyDancr agent commission; MyDancr’s written authorization and qualifying events are still required.

## 9. Reverification and failure

MyDancr may reverify after material account changes, suspicious activity, expired documents, affiliation disputes, payout failures, sanctions alerts, security incidents, or legal requirements. Failure or refusal may restrict the relevant feature. A User may appeal a mistaken result but cannot require MyDancr to accept unverifiable evidence.

## 10. Data minimization

Verification should collect the minimum evidence necessary, separate public stage identity from legal identity, limit retention, log access, prohibit ordinary email transmission of documents, and avoid exposing government identifiers to clubs, dancers, customers, or agents.

---PAGE---

# Part IX — Draft DMCA and Takedown Policy

## 1. Designated agent

The published policy must list Company’s Copyright Office-registered designated agent name, organization, complete mailing address, phone if used, and email, and must remain synchronized with the Copyright Office directory. Registration renewal must be calendared.

## 2. Copyright notice

A notice should identify the copyrighted work; identify the material and provide information reasonably sufficient to locate it; provide claimant contact information; state a good-faith belief that use is not authorized by the owner, agent, or law; state under penalty of perjury that the notice is accurate and the claimant is authorized; and include a physical or electronic signature.

MyDancr may ask for missing information. Knowingly material misrepresentations can create liability. Notices should target specific URLs, profile/media IDs, or other locators rather than an entire account when narrower action is possible.

## 3. Action on a complete notice

MyDancr will expeditiously restrict or remove identified material where appropriate, notify the uploader, preserve the case record, and provide counter-notice information. MyDancr may forward the notice, including claimant contact information, to the uploader. The claimant should understand this disclosure before submission.

## 4. Counter-notice

A counter-notice should identify removed material and its former location; state under penalty of perjury a good-faith belief that removal resulted from mistake or misidentification; provide name, address, and phone; consent to the jurisdiction required by 17 U.S.C. § 512(g); accept service from the claimant or agent; and include a signature.

MyDancr may forward the counter-notice to the claimant. Unless the claimant gives timely notice of a filed court action seeking restraint, MyDancr may restore material in the statutory window, subject to independent policy rules.

## 5. Other rights complaints

Trademark, privacy, publicity, impersonation, nonconsensual imagery, and safety complaints are not DMCA notices and should use reporting/support channels. MyDancr may restrict material under its Terms even if a DMCA counter-notice is valid.

## 6. Repeat infringers

MyDancr maintains and reasonably implements a repeat-infringer policy in appropriate circumstances. Strikes should be tied to valid cases, permit consideration of retractions/court outcomes/counter-notices, and support termination where appropriate. Users may not evade termination with new accounts.

## 7. Preservation and abuse

Case records, notices, counters, delivery, actions, and restoration dates are retained for the approved legal period. Fraudulent, abusive, or knowingly false submissions may be rejected, referred, or support account enforcement.

---PAGE---

# Part X — Draft Club Deal and NFC Redemption Terms

## 1. Nature of a Club Deal

A Club Deal is a limited promotional benefit offered by the identified club. It is not cash, stored value, a reservation, a ticket, a promise of entry, or a payment for any dancer service. Current categories are half-off admission and skip-the-line. The club is responsible for the offer and lawful fulfillment.

## 2. Eligibility and conditions

The user must satisfy the club’s lawful age, identification, capacity, dress code, hours, safety, and house rules. A deal may have one redemption per guest, session, time period, or other clearly disclosed limit. Unless the deal says otherwise, it cannot be combined, transferred, resold, or exchanged for cash.

## 3. Selection and redemption

Selecting a deal creates an eligible checkout/redemption state but does not complete redemption. At the cashier, the user unlocks the device and holds it near the official MyDancr cashier NFC tag. The browser or app opens the server flow, which must confirm the correct club, deal, token, status, expiry, tag, and duplication rules. Only a successful server response completes redemption.

## 4. Attribution

If the user selected the deal through an eligible dancer’s public profile—including an eligible shift or deal surface presented within that profile—MyDancr locks that source before issuing the redemption token. A successful cashier NFC confirmation that otherwise satisfies these terms creates a Profile-Originated Verified Redemption. Its dancer reward equals **30%, 40%, or 50% of the applicable MyDancr gross referral fee** according to whether it is the dancer’s 1st–9th, 10th–24th, or 25th-and-later qualifying event in the commission month. The user and club may not change or erase valid source data. A club-page-only redemption without dancer-profile attribution creates no dancer reward. No customer charge or dancer-service transaction is created.

## 5. Prohibited offers and use

No alcohol, drink, bottle service, sexual service, cash, gambling, controlled substance, weapon, illegal product, or deceptive offer is allowed. Users may not counterfeit, automate, copy, relay, tamper, duplicate, sell, or exploit tokens/tags; use multiple accounts/sessions to evade limits; or induce staff to bypass confirmation.

## 6. Club obligations

The club must train staff, place the tag in the approved cashier location, maintain connectivity and alternate support steps, honor valid redemptions on published terms, display exclusions clearly, protect the tag, and report compromise. The club may refuse entry for a lawful disclosed reason but may not falsely mark a redemption or discriminate unlawfully.

## 7. Errors, outages, and disputes

If a server or tag outage prevents confirmation, no unverified screen should automatically create a commission or invoice. The user or club may contact support with the deal, club, time, and reference. MyDancr may verify logs, correct a technical error, or deny a claim lacking reliable evidence. Screenshots are not final proof.

## 8. Expiry and changes

The club may prospectively pause or end a deal subject to existing consumer obligations and notice. MyDancr may suspend a deal for risk or noncompliance. An issued token expires on the server schedule. Terms displayed at selection should be preserved with the redemption record.

---PAGE---

# Part XI — Draft Dancer Commission, Agent Referral, and Payout Terms

## 1. Overview

These terms govern rewards for eligible dancers and, only if separately authorized, commissions for contracted agents. They do not govern club wages, tips, dancer services, customer purchases, or employment compensation. “Commission Event” means a server-created record that satisfies the applicable policy and attribution rules. “Profile-Originated Verified Redemption” means an allowed Club Deal redemption successfully confirmed by the correct club’s authorized cashier NFC tag where the immutable source captured before token issuance identifies an eligible dancer’s public profile—including a qualifying shift or deal surface presented within that profile—as the customer journey’s origin. “Approved Payout Provider” means a legally suitable provider selected under a signed production contract after MyDancr’s business model and payout use case have been approved.

## 2. Qualifying dancer event

A dancer reward requires all of the following at confirmation: an allowed active Club Deal; a valid server-issued redemption; successful cashier NFC confirmation at the correct club; nonexpired, nonduplicate, nonfraudulent status; immutable source from the dancer’s public profile, including an eligible shift or deal surface within that profile; complete dancer, club, deal, token, and shift/context attribution where required; and an account not disqualified by sanctions, fraud, or legal restriction.

Views, follows, directions, social clicks, applause, “going,” unverified selections, failed taps, club-page-only redemptions without dancer attribution, screenshots, demo data, or prohibited offers do not qualify.

## 3. Tiered profile-originated dancer share

The attributed dancer’s share of the applicable MyDancr gross referral fee is determined by the event’s ordinal among that dancer’s qualifying Profile-Originated Verified Redemptions in the commission month:

- **1st–9th qualifying event:** 30% dancer share; 70% retained by MyDancr.
- **10th–24th qualifying event:** 40% dancer share; 60% retained by MyDancr.
- **25th and each later qualifying event:** 50% dancer share; 50% retained by MyDancr.

The commission month is the calendar month determined in the verified club’s configured local timezone. Tiers apply incrementally, not retroactively: an event is priced at the tier reached when the authorized cashier NFC confirmation occurs, and a later tier does not reprice prior events. The gross referral fee is the fee in the club’s effective term, not admission price, deal value, club revenue, tip, or dancer compensation. The event stores the source profile, commission month, ordinal, policy version, 3,000-, 4,000-, or 5,000-basis-point share, gross fee, currency, club, deal, dancer, shift/context, token, cashier confirmation, timestamps, and calculation snapshot.

A future change to a percentage, threshold, commission-month rule, or qualifying source applies only prospectively after clear notice and renewed acceptance where required; it must not silently alter an accrued event.

## 4. Separate club receivable

The club’s referral-fee obligation and MyDancr’s dancer reward are separate. The club invoice can be pending while the dancer reward is payable. MyDancr may not deny an otherwise valid reward solely because the club has not paid, but may correct or hold an event for fraud, duplication, mistake, reversal, illegality, sanctions, or a genuine attribution dispute.

## 5. Authorized agent commission

No agent commission exists unless MyDancr and the agent have signed a separate Agent Agreement or order that identifies the agent, qualifying event, attributed club or portfolio, rate/formula, currency, effective dates, attribution tail if any, exclusions, and payout conditions. An introduction, email, demo, account signup, recruiting claim, or club team role does not create a commission.

Agent compensation must arise from the written event specified in the order, such as collected platform revenue from a contracted club. Unless the order expressly and lawfully states otherwise, agent commission is not calculated from dancer rewards and does not reduce them. No commission is paid for recruiting another agent or for a downline.

## 6. Attribution conflicts

The server’s contemporaneous records, accepted club order, event timestamps, and administrator audit control attribution. MyDancr may investigate duplicate claims, self-dealing, preexisting accounts, inactive periods, reassignment, and fraud. A payee must dispute a statement within the counsel-approved period and identify the specific event.

## 7. Payout-provider onboarding

A payee must establish an eligible account with the Approved Payout Provider, complete its identity/KYC, sanctions, tax, and account-matching checks, and authorize required data exchange. MyDancr may store the beneficiary/account identifier, onboarding status, payout eligibility, transfer reference, and error status but should not store full external account credentials. Provider terms, country availability, account restrictions, reserves, limits, fees, inactivity charges, foreign exchange, payment methods, and review apply independently.

MyDancr will not enable live commission payouts until an Approved Payout Provider is selected and configured. If the selected integration later becomes unavailable or legally unsuitable, MyDancr may change providers with reasonable notice and a transition period, subject to accrued-payment duties and applicable law. The payee may need to complete new onboarding before further payout.

## 8. Statements, payout cycle, and minimums

The dashboard or statement shows pending, payable, paid, failed, reversed, or held status and available references. The final version must state payout frequency, cutoff timezone, minimum balance, fee allocation, returned-payment handling, and final payout. Amounts below the minimum may roll forward unless law requires otherwise.

[CALLOUT:COUNSEL|Commercial schedule] Approve an attached Payout Schedule. It should be operationally achievable and should address weekends/holidays, provider delay, KYC failure, inactive accounts, death/incapacity, unclaimed property, tax holds, currency conversion, and record disputes.

## 9. Holds, corrections, reversals, and offsets

MyDancr may place a proportionate hold during a documented investigation of duplicate or fabricated redemptions, tag compromise, account takeover, sanctions, legal process, provider review, material breach, or calculation error. MyDancr will release undisputed amounts when feasible. It may correct a mistake, reverse an invalid event, or offset a documented overpayment as permitted by law and with statement detail.

## 10. Taxes and classification

Payees are responsible for taxes, business registration, and professional advice. MyDancr may request tax forms, report payments, and withhold where required. A commission does not create employment, club agency, franchise, partnership, or authority to bind MyDancr. Agents may not make unapproved promises or earnings claims.

## 11. No transfer and survival

Commission rights may not be sold, pledged, assigned, or redirected except with written approval or by law. Accrued undisputed obligations and audit/dispute terms survive termination. Fraudulent or illegal events never become payable.

---PAGE---

# Part XII — Draft Moderation, Reporting, Suspension, and Appeals Policy

## 1. Scope and principles

MyDancr moderates to protect adults, consent, lawful club promotion, rights, finance integrity, and system safety. Decisions may involve automated tools and trained reviewers. MyDancr prioritizes imminent harm, minors, trafficking, nonconsensual content, credible threats, account takeover, payout fraud, and tag compromise.

## 2. Content states

Content and accounts may be draft, checking, pending review, approved, rejected, restricted, disabled, removed, or restored. A prior approval does not prevent later review after a report, model update, rights complaint, changed context, or legal requirement. Pending content is not public and should not count toward approval requirements.

## 3. Automated review

Automated tools may assess file integrity, nudity/sexual content, age risk, violence, drugs, text, logos, spam, fraud, or duplication. Inputs and outputs should be access-controlled and recorded with provider/model/version where practical. Automated review must not be represented as infallible or as legal approval.

## 4. User reports

A reporter should identify the target, category, and enough facts to investigate. MyDancr may request clarification but should minimize sensitive evidence. Emergency or criminal conduct should be reported to emergency services or authorities. Knowingly false, retaliatory, or abusive reports may lead to enforcement.

## 5. Review and action

Reviewers may approve, restrict, remove, request information, disable features, suspend accounts, revoke affiliations/tags, void events, hold payouts, or escalate. The record should include issue, evidence, rule, action, reviewer, timestamp, notice, and appeal. Access must be least-privilege, especially for identity, intimate media, location, and payout data.

## 6. Notice

When lawful and safe, MyDancr should tell the affected User what was acted on, the general reason/policy, duration, required correction, and appeal method. Notice may be delayed or limited to protect a reporter, investigation, security control, minor, trafficking victim, legal process, or other person.

## 7. Immediate suspension

MyDancr may act before full review for suspected minors/CSAM, trafficking, nonconsensual intimate imagery, credible violence, account takeover, sanctions, material fraud, tag compromise, legal order, or imminent platform harm. A hold should be no broader or longer than reasonably necessary.

## 8. Appeals

An eligible User may appeal once within the approved period, identify the decision, explain the mistake, and provide lawful evidence. A reviewer not solely responsible for the original decision should assess material appeals where feasible. MyDancr should communicate outcome and restore access/content when appropriate. Repetitive or abusive appeals may be closed.

## 9. Club and affiliation disputes

Affiliation disputes should compare club authority, dancer account, verification event, timing, and current relationship. MyDancr may temporarily hide the affiliation without deciding employment rights. A club cannot use MyDancr review to withhold legal wages or retaliate; a dancer cannot require a club to confirm a relationship it disputes.

## 10. Finance disputes

Commission disputes use immutable redemption, tag, source, club, shift, policy-version, and payout records. MyDancr may separate undisputed amounts. Clubs cannot see private dancer payout terms; dancers and agents cannot see unrelated club billing or other payees.

## 11. Repeat violations and termination

MyDancr may escalate warnings to restriction, suspension, or termination based on severity, pattern, intent, and risk. Copyright repeat-infringer decisions use the DMCA policy. Evasion through a new account is prohibited.

## 12. Law enforcement and transparency

MyDancr will respond to valid legal process and may make emergency or mandatory reports where required. Requests should be authenticated, scoped, logged, and reviewed. MyDancr may publish aggregate transparency information that does not identify Users.

---PAGE---

# Part XIII — Draft Data-Retention and Account-Deletion Policy

## 1. Principles

MyDancr retains personal information only for a documented operational, contractual, security, safety, financial, rights, or legal purpose. Retention is based on record class rather than keeping every account record indefinitely. Access becomes more restricted when a record is no longer active.

## 2. Proposed retention schedule for counsel approval

- **Authentication and active account:** life of account; security/session metadata for a short rolling period; deletion processing after authenticated request.
- **Public profile fields and ordinary content:** while published plus a short removal/cache period; transformed/storage copies deleted through a verified cleanup job; backups expire on cycle.
- **Rejected uploads:** short appeal and abuse-prevention period; longer restricted hash/decision where necessary to prevent reupload or address safety.
- **Yoti identity and age evidence:** configure Yoti’s shortest workable time-to-live; retain in MyDancr primarily the session/reference, requested checks, result, decision, and dates; retain document/selfie/biometric material only when specifically justified by law and approved policy.
- **Affiliation and NFC presence:** active relationship plus a limited audit/fraud/dispute period; public status expires promptly.
- **Precise geolocation:** shortest operational/fraud window feasible; retain derived pass/fail, distance, accuracy, and event evidence longer only if necessary.
- **Views, clicks, rankings, and analytics:** rolling product/analytics period, then aggregate or deidentify; delete direct identifiers when no longer needed.
- **Club Deal tokens and attempts:** token life plus fraud/dispute period.
- **Verified redemptions, invoices, commission, payout, and tax records:** statutory accounting/tax period plus open dispute, audit, chargeback, and legal-hold needs.
- **Payout-provider references:** beneficiary/account identifier, transfer reference, status, amount, currency, failure/hold reason, and reconciliation record through the approved finance/statutory period; never retain the provider password or unnecessary payment-account credentials. The provider independently retains regulated KYC and transaction data under its policy.
- **Support and account recovery:** case life plus quality, security, and dispute period; remove unnecessary identity evidence.
- **Reports and moderation:** action/appeal period plus safety, repeat-abuse, and claim-defense needs.
- **DMCA:** statutory, litigation, repeat-infringer, and defense period.
- **Club/agent agreements and fee/commission orders:** agreement life plus limitation, tax, audit, and dispute period.
- **Administrative and security logs:** risk-based rolling period; longer for material incidents or legal hold.

[CALLOUT:COUNSEL|Exact periods required] Convert every “short,” “limited,” “rolling,” and “statutory” period above into an approved number of days/years and confirm backup architecture, tax law, limitation periods, DMCA, performer-record duties, fraud models, and state privacy requirements.

## 3. Account deletion process

An authenticated User may request deletion in account controls. MyDancr should confirm scope and consequences, stop public display, disable access, delete the authentication user, queue database/storage/provider cleanup, and provide confirmation. A recovery or privacy process is available when the User cannot sign in.

Deletion is not complete merely because a database row cascades. The process must cover storage objects, transformed media, search/cache entries, push identifiers, email lists, provider data where Company controls deletion, and orphan detection. Jobs should be idempotent, logged, retried, and monitored.

## 4. Exceptions

MyDancr may retain minimum records required for unpaid/paid invoices and commissions, taxes, fraud/security, chargebacks, DMCA, reports, consent/release evidence, legal claims, sanctions, and legal holds. Retained data is not used for ordinary promotion and should be segregated or access-restricted.

## 5. Club, dancer, and agent records

Deleting a User account does not delete another legal entity’s records or rewrite historical events. A dancer’s public profile can be removed while a club invoice and dancer payout event retain a pseudonymous or internal reference. A club account deletion does not erase consumer redemption support or an accepted fee term. Agent termination does not erase earned/paid statements or tax records.

## 6. Backups and vendors

Backups are protected from ordinary use and expire through the documented cycle. If restored, deletion tombstones or replay jobs prevent deleted data from silently becoming active. Vendor contracts should require deletion/return, security, incident notice, subprocessors, and assistance with rights requests, subject to provider legal retention.

## 7. Legal holds

Authorized legal personnel may place a scoped hold that suspends ordinary deletion for identified records. Holds should identify matter, owner, scope, start, review, and release. Users may receive a limited response where disclosure of the hold is prohibited.

## 8. Deidentification and aggregation

Where retention of trends is useful, MyDancr should aggregate or deidentify so information is not reasonably linkable to a person, maintain technical/contractual controls against reidentification, and not present deidentified data as anonymous if linkage remains reasonably possible.

---PAGE---

# Implementation and attorney handoff checklist

## Publication prerequisites

1. Insert legal entity, addresses, effective dates, and contacts in every public document.
2. Register and verify the DMCA agent; calendar renewal; match the public page.
3. Execute and configure the Yoti organization/IDV agreement, data-processing terms, U.S. biometric addenda where applicable, requested-check template, time-to-live, portal access, incident process, and “powered by Yoti” disclosure.
4. Select, contract with, and configure an Approved Payout Provider; confirm its legal identity, supported payee countries/currencies, KYC, funding, fees, reserves, transaction limits, complaints, data protection, and reconciliation.
5. If agents launch, execute a separate Agent Agreement and order; implement role, authorization, attribution, statements, tax, approved-provider payout, suspension, and deletion before any commission is promised.
6. Approve club order form and fee term; display the effective fee to the authorized signer.
7. Implement clickwrap acceptance with document version, timestamp, user/account, IP/user agent as appropriate, and downloadable copy.
8. Separate customer Terms acceptance from Dancer, Club, Agent, Media, Club Deal, Yoti, and approved-provider payout acceptances/notices.
9. Train verification reviewers; restrict Yoti portal/report access; test deletion and reverification.
10. Confirm media categories, 2257/2257A analysis, releases, music rights, and emergency reporting.
11. Confirm every Club Deal category and enforce the alcohol/sexual-service prohibition at database and API boundaries.
12. Validate that only approved affiliated clubs appear for dancer shifts.
13. Validate first-time venue gate and later affiliation flows on real mobile devices.
14. Validate NFC tag types, installation, rotation, compromise, offline/error, duplicate, expiry, and audit flows.
15. Validate immutable dancer-profile source attribution, the 1–9/10–24/25+ monthly tier boundaries, nonretroactive event pricing, and independent club/dancer ledgers with test redemptions and reversals.
16. Finalize the approved-provider payout schedule, minimum, tax, failure, hold, reversal, fee, and unclaimed-property handling.
17. Map all production providers/subprocessors and execute privacy/security terms.
18. Implement exact retention/deletion jobs and evidence; test storage cleanup and backup restore behavior.
19. Configure marketing consent and opt-out; keep transactional/security notices separate.
20. Adopt incident response, law-enforcement, trafficking/minor, and emergency escalation playbooks.
21. Complete state/local licensing and privacy review before each city launch.

## Acceptance matrix

- **Visitor:** Terms and Privacy notice; no account acceptance, but clear browse/use notice.
- **Customer:** Terms + Privacy; optional notification/marketing consent; Club Deal terms at selection/redemption.
- **Dancer:** Terms + Privacy + Dancer Agreement + Content/Media License + Acceptable Use + Verification + Yoti notice/consent where required + approved-provider Commission/Payout terms; renewed acceptance for material commission changes.
- **Club owner/authorized signer:** Terms + Privacy + Club Agreement + order/fee term + NFC/Deal terms + data/security obligations.
- **Club manager/staff:** Terms + Privacy + Acceptable Use + team-role acknowledgment + NFC handling; no authority to accept owner-only commercial changes unless granted.
- **Agent if launched:** Terms + Privacy + separate Agent Agreement/order + Acceptable Use + Yoti verification notice + approved-provider payout/tax terms + marketing standards.
- **Administrator/support:** workforce confidentiality, access, moderation, security, finance, privacy, incident, DMCA, and acceptable-use policies.

## Product counsel test scripts

- Create each account role; confirm copy and acceptance version.
- Complete Yoti dancer onboarding with successful, failed, abandoned, manual-review, expired, mismatched, deleted, and reverification outcomes; then test approved, pending, rejected, deleted, and appealed media.
- Confirm deleted media stays deleted after reload and is removed from public/storage paths.
- Preview a dancer profile and compare it to the live component, including videos and social links.
- Complete first club verification and a later affiliation change; attempt an unauthorized shift.
- Run dressing-room NFC Working Now start, expiry, cooldown, checkout, revoked tag, and wrong-club cases.
- Publish allowed and prohibited Club Deals; verify API/database enforcement.
- Select from club and dancer contexts; test cashier NFC, expiry, duplicate, screenshot, wrong club, revoked tag, anonymous and signed-in states.
- Reconcile club invoice, profile-originated tier ordinals 1, 9, 10, 24, and 25, month reset, independent dancer payable, payout-provider success/failure, KYC hold, reserve, wrong/mismatched beneficiary, correction, fee, and statement.
- If agents launch, test no-contract, expired order, duplicate claim, preexisting club, qualifying event, payout failure, and termination.
- Exercise follow, going, favorite, notification opt-out, email classification, account recovery, reports, moderation, appeal, DMCA, deletion, legal hold, and vendor cleanup.

# Closing attorney review note

The strongest legal posture will come from keeping product behavior narrower than promotional language: public club discovery, approved adult promotional media, venue-confirmed affiliations, limited schedules, admission/line-access Club Deals, verified NFC events, transparent referral attribution, provider-processed payouts, and auditable safety/enforcement. Any later messaging, booking, paid content, customer payments, alcohol offers, private-services marketplace, or multi-level agent program would materially change this packet and should not launch through an informal feature update.

---PAGE---

# Selected primary authorities and provider materials

Counsel should confirm the applicability, current version, and jurisdictional scope of every authority before publication. This list supports issue spotting; it is not an opinion that any statute necessarily applies.

- **Nevada Revised Statutes, Chapter 603A — Security and Privacy of Personal Information:** [https://www.leg.state.nv.us/NRS/NRS-603A.html](https://www.leg.state.nv.us/NRS/NRS-603A.html)
- **U.S. Copyright Office — Section 512 safe harbors and notice-and-takedown resources:** [https://www.copyright.gov/512/](https://www.copyright.gov/512/)
- **FTC — Disclosures 101 for Social Media Influencers:** [https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
- **FTC — CAN-SPAM Act compliance guide:** [https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- **FCC — TCPA unlawful-text-message small entity compliance guide:** [https://docs.fcc.gov/public/attachments/DA-24-859A1.pdf](https://docs.fcc.gov/public/attachments/DA-24-859A1.pdf)
- **18 U.S.C. § 2257 — performer recordkeeping requirements:** [https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title18-section2257](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title18-section2257)
- **18 U.S.C. § 2421A — promotion or facilitation of prostitution and reckless disregard of sex trafficking:** [https://uscode.house.gov/view.xhtml?req=%28title%3A18+section%3A2421a+edition%3Aprelim%29](https://uscode.house.gov/view.xhtml?req=%28title%3A18+section%3A2421a+edition%3Aprelim%29)
- **Clark County business-license category and fee schedule:** [https://www.clarkcountynv.gov/adobe/assets/urn%3Aaaid%3Aaem%3Aed9e0b17-c87d-46b8-9ee9-4e044cf84ac2/original/as/list-of-categories-and-fees.pdf](https://www.clarkcountynv.gov/adobe/assets/urn%3Aaaid%3Aaem%3Aed9e0b17-c87d-46b8-9ee9-4e044cf84ac2/original/as/list-of-categories-and-fees.pdf)
- **Yoti Identity Verification privacy notice:** [https://www.yoti.com/privacy/identity-verification/](https://www.yoti.com/privacy/identity-verification/)
- **Yoti organization terms:** [https://www.yoti.com/terms/organisations/](https://www.yoti.com/terms/organisations/)
- **Yoti identity-verification product description:** [https://www.yoti.com/business/identity-verification/](https://www.yoti.com/business/identity-verification/)
