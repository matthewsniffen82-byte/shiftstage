import { MAX_DANCER_PROFILE_PHOTOS, MAX_DANCER_PROFILE_VIDEOS, MIN_DANCER_ONBOARDING_PHOTOS } from "./media-limits.ts";
import { NFC_COOLDOWN_HOURS, NFC_WORKING_WINDOW_HOURS } from "./shift-presence.ts";
import { OPERATIONS_SUPPORT_EMAIL } from "./operations-guides.ts";

export type HelpRole = "customer" | "dancer" | "venue" | "vip" | "staff" | "admin" | "reviewer" | "support" | "billing";
export const HELP_ROLE_LABELS: Record<HelpRole, string> = {
  customer: "Guest", dancer: "Dancer", venue: "Club", vip: "VIP", staff: "Club staff",
  admin: "Admin", reviewer: "Content reviewer", support: "Support staff", billing: "Billing staff",
};
type Topic = {
  id: string; roles: readonly HelpRole[]; title: string; phrases: readonly string[];
  answer: string; href?: string;
  // Reviewed against these implementation files. Keep this list and answers in step with product changes.
  sources: readonly string[];
};
const guests = ["customer", "vip"] as const;
const clubs = ["venue", "staff"] as const;
const admins = ["admin", "reviewer", "support", "billing"] as const;
const everyone = [...guests, ...clubs, ...admins, "dancer"] as const;

export const HELP_TOPICS: readonly Topic[] = [
  { id: "guest-alerts", roles: guests, title: "Which alerts can I receive?", phrases: ["alerts", "notifications", "working now alerts", "upcoming shifts", "club deals", "new dancers"],
    answer: "Alerts has four follow updates: Working Now, Upcoming shifts, New Club Deals and New dancers. Follow alerts pauses or resumes all four. Each type also has its own switch. Follow emails and push notifications are separate delivery choices, and changes save automatically.", href: "/dashboard/customer#customer-alerts", sources: ["src/lib/dancr/customer-notification-preferences.ts"] },
  { id: "guest-push", roles: guests, title: "Enable push on this device", phrases: ["push", "enable push", "phone alerts", "browser notifications", "device notifications"],
    answer: "In Alerts, turn on Push notifications, then select Enable push on this device and allow notifications in your browser. The preference switch alone does not register a device. If permission was blocked, update this site's notification permission in your browser before trying again.", href: "/dashboard/customer#customer-alerts", sources: ["app/dashboard/CustomerDashboardPanels.tsx"] },
  { id: "guest-follow", roles: guests, title: "Save and follow dancers or clubs", phrases: ["follow", "following", "saved", "favorites", "favourites", "unfollow", "save dancer"],
    answer: "Use Follow on a dancer or club to save it and receive the follow updates you enable. Your Saved tab keeps followed dancers and clubs together. You can stop following from the saved item. Only participating MyDancr dancers appear in discovery.", href: "/dashboard/customer#customer-saved", sources: ["app/dashboard/CustomerDashboardPanels.tsx"] },
  { id: "guest-privacy", roles: guests, title: "Who can see my account?", phrases: ["privacy", "private", "public account", "share email", "share phone", "club contact", "who can see"],
    answer: "Your guest account and activity are not public. In Account → Club contact permissions, review or stop shared contact details and direct club email or text updates. Following adds updates to Alerts; direct club emails and texts need a separate opt-in. Stopping contact sharing does not delete guest-list or ride records held by the club.", href: "/dashboard/customer#customer-account", sources: ["app/dashboard/CustomerClubPrivacyPanel.tsx"] },
  { id: "guest-marketing", roles: guests, title: "Change promotional emails", phrases: ["marketing", "promotions", "newsletter", "unsubscribe", "offers email"],
    answer: "Account has the choice for MyDancr offers and newsletters. This is separate from Follow emails in Alerts, which controls updates from dancers and clubs you follow. Turn off the type of email you no longer want.", href: "/dashboard/customer#customer-account", sources: ["src/lib/dancr/customer-notification-preferences.ts"] },
  { id: "guest-discovery", roles: ["customer"], title: "Find dancers working now", phrases: ["find dancers", "working now", "no dancers", "city", "distance", "filter"],
    answer: "Choose a city on MyDancr, then use the club and distance filters. Working Now shows participating dancers currently visible as working. A zero count does not mean no dancers are working at the club; other dancers may not be participating or publicly visible.", href: "/", sources: ["outputs/index.html"] },
  { id: "dancer-onboarding", roles: ["dancer"], title: "Get my profile ready", phrases: ["onboarding", "get started", "setup", "approval", "go live", "not public"],
    answer: `Follow the setup checklist in your dashboard: complete your profile, add at least ${MIN_DANCER_ONBOARDING_PHOTOS} approved profile photos, complete the dancer agreement and finish the required club review. The avatar is separate from the gallery. Check the displayed review status for anything that needs attention; this assistant cannot approve a profile or predict review timing.`, href: "/dashboard/dancer#profile", sources: ["app/dashboard/DashboardClient.tsx", "src/lib/dancr/media-limits.ts"] },
  { id: "dancer-photos", roles: ["dancer"], title: "Manage photos and videos", phrases: ["photos", "pictures", "gallery", "upload", "video", "media", "replacement"],
    answer: `Open Profile to manage photos and videos. You can keep up to ${MAX_DANCER_PROFILE_PHOTOS} photos and ${MAX_DANCER_PROFILE_VIDEOS} videos. New media goes through review; check its status and any replacement note. Approved media can remain visible while new media is pending.`, href: "/dashboard/dancer#profile", sources: ["app/dashboard/DancerDashboardPanels.tsx", "src/lib/dancr/media-limits.ts"] },
  { id: "dancer-avatar", roles: ["dancer"], title: "Adjust my avatar", phrases: ["avatar", "face", "crop", "main photo", "profile picture"],
    answer: "Your main photo is used to prepare the avatar crop. In Profile, use Adjust avatar crop to position the part of the photo you want in the circle, then save. Check both the main photo and the round preview.", href: "/dashboard/dancer#profile", sources: ["app/dashboard/DancerAvatarPanel.tsx"] },
  { id: "dancer-checkin", roles: ["dancer"], title: "Start or end Working Now", phrases: ["working now", "check in", "check out", "nfc", "tap", "cooldown", "sticker", "end shift"],
    answer: `Tap the club's dressing-room NFC sticker to start Working Now for ${NFC_WORKING_WINDOW_HOURS} hours. A ${NFC_COOLDOWN_HOURS}-hour cooldown follows across clubs. Tapping again does not extend the session. Ending early stops Working Now but does not clear the cooldown. Check the visibility choice at check-in and the status shown in your dashboard.`, href: "/dashboard/dancer", sources: ["src/lib/dancr/shift-presence.ts", "app/dashboard/DancerNfcPanel.tsx"] },
  { id: "dancer-visibility", roles: ["dancer"], title: "Choose public or club-only visibility", phrases: ["visibility", "club only", "internal", "public", "hide profile"],
    answer: "At check-in, choose Internal only, External only or Both. Internal only is visible inside the club and to that club’s invited VIP guests, and hidden from public discovery. External only shows your public profile without placing you on the internal roster. Both enables both destinations. Profile visibility can also be managed separately in Profile.", href: "/dashboard/dancer#dancer-visibility", sources: ["src/lib/dancr/visibility-mode.ts", "app/dashboard/DancerDashboardPanels.tsx"] },
  { id: "dancer-results", roles: ["dancer"], title: "View my results", phrases: ["results", "performance", "analytics", "views", "followers"],
    answer: "Open Results in your dancer dashboard to review the activity and performance available for your profile. Use its time-period controls where offered. I can explain where to find results, but I cannot read your current totals.", href: "/dashboard/dancer#results", sources: ["app/dashboard/DancerDashboardWorkspace.tsx"] },
  { id: "club-approval", roles: ["venue"], title: "My club is waiting for approval", phrases: ["approval", "application", "waiting", "club request", "rejected", "dashboard locked"],
    answer: "A pending club request keeps your manager login saved. Select Check approval status on the request screen. Once approved, the dashboard unlocks with the same account and an email is sent. If the request was not approved, send the team a message for help with that decision.", href: "/dashboard/venue", sources: ["app/dashboard/DashboardClient.tsx"] },
  { id: "club-team", roles: ["venue"], title: "Invite or manage the club team", phrases: ["team", "invite staff", "manager", "permissions", "access levels", "owner"],
    answer: "Open Team & activity to review access. Only the owner can invite or remove members, change access levels or remove the club from MyDancr. Managers can edit the profile, manage dancer access and request deal changes. Staff have a more limited view and cannot make those changes. Owner access cannot be granted by invitation.", href: "/dashboard/venue#venue-team", sources: ["src/lib/dancr/venue-team-role-descriptions.ts"] },
  { id: "staff-access", roles: ["staff"], title: "What can club staff do?", phrases: ["permissions", "access", "team", "edit club", "manager", "owner", "invite"],
    answer: "Club staff can view the dashboard, results, deals, dancers and stickers, end check-ins and use sticker support. Staff cannot edit the club profile, manage dancer access, request deal changes or view team activity. Ask the club owner to review your access if you need more permissions.", href: "/dashboard/venue", sources: ["src/lib/dancr/venue-team-role-descriptions.ts"] },
  { id: "club-roster", roles: clubs, title: "Manage the live roster", phrases: ["roster", "working now", "check in", "check out", "end check", "dancer access"],
    answer: "The club's Dancers workspace shows the roster and Working Now check-ins. Staff can end check-ins; dancer-access changes require owner or manager access. Internal visibility is chosen by each dancer at check-in, so the internal roster and public discovery can differ.", href: "/dashboard/venue#venue-working-now", sources: ["app/dashboard/VenueDashboardPanels.tsx", "src/lib/dancr/venue-team-role-descriptions.ts"] },
  { id: "club-tables", roles: clubs, title: "Handle table requests", phrases: ["table", "requests", "mark seen", "arrived", "no show", "dismiss"],
    answer: "Open Table requests in the club dashboard. Mark seen acknowledges a pending request. Record Mark arrived or Didn’t arrive at table as appropriate, then Complete once handled. Dismiss cancels a request. Use the dancer profile to check details before changing a request.", href: "/dashboard/venue#table-requests", sources: ["app/internal/InternalRoster.tsx"] },
  { id: "club-stickers", roles: clubs, title: "Get help with NFC stickers", phrases: ["nfc", "sticker", "tap", "cooldown", "qr code"],
    answer: `Use the Stickers section for club check-in tools and sticker support. Dressing-room NFC taps start ${NFC_WORKING_WINDOW_HOURS} hours of Working Now, followed by a ${NFC_COOLDOWN_HOURS}-hour cooldown across clubs. Table QR links serve a different purpose: guest table requests. Contact the team if a sticker or table sign is assigned incorrectly.`, href: "/dashboard/venue#venue-nfc-tags", sources: ["app/dashboard/VenueNfcTagPanel.tsx", "src/lib/dancr/shift-presence.ts"] },
  { id: "club-deals", roles: ["venue"], title: "Request a club deal change", phrases: ["deal", "offer", "promotion", "discount"],
    answer: "Current Club Deals are managed by MyDancr. An owner or manager can request a change from the Club Deals section. Check the request's status there; sending a request does not immediately publish a new deal.", href: "/dashboard/venue#venue-club-deals", sources: ["app/dashboard/VenueDashboardPanels.tsx", "src/lib/dancr/venue-team-role-descriptions.ts"] },
  { id: "club-publish", roles: ["venue"], title: "Publish or update the club page", phrases: ["publish", "website", "club page", "profile", "logo", "hours", "grid"],
    answer: "Open the Club workspace to review the setup checklist, public profile and publication controls. Owner and manager access can edit the profile. The website grid section provides club website integration tools. Review the displayed readiness requirements before publishing.", href: "/dashboard/venue#venue-publication", sources: ["app/dashboard/VenueDashboardPanels.tsx", "app/dashboard/VenueSetupChecklist.tsx"] },
  { id: "club-guests", roles: ["venue"], title: "Find VIP visits, guest lists and rides", phrases: ["vip", "guest list", "guests", "pickup", "ride", "contacts"],
    answer: "Use the Guests area in the club's Tonight workspace to manage the available guest-list, VIP, pickup and shared-contact tools. Guests control which contact details they share. Review each request's current status before confirming or changing it.", href: "/dashboard/venue#venue-guest-list", sources: ["app/dashboard/VenueGuestsPanel.tsx", "app/dashboard/VenueDashboardPanels.tsx"] },
  { id: "club-results", roles: clubs, title: "Read club results", phrases: ["results", "analytics", "performance", "numbers", "statistics"],
    answer: "Open Results in the club dashboard and select the time period you want to review. The dashboard distinguishes activity and operational metrics. I cannot access your live counts or verify a particular discrepancy; send the team the metric and date range if a number looks wrong.", href: "/dashboard/venue#venue-overview", sources: ["app/dashboard/VenueDashboardPanels.tsx"] },
  { id: "vip-access", roles: ["vip"], title: "Use a private VIP invitation", phrases: ["invitation", "invite", "access", "venue", "club", "empty lounge"],
    answer: "Open a private VIP invitation from your venue to activate access. Each invitation unlocks that venue's dancers and visit requests. If you have access to multiple venues, use the venue selector at the top of the lounge. Your guest sign-in also supports VIP access.", href: "/vip#vip-account", sources: ["app/vip/VipDashboard.tsx", "app/vip/VipClient.tsx"] },
  { id: "vip-plan", roles: ["vip"], title: "Plan a VIP visit", phrases: ["plan", "visit", "choose dancers", "my dancers", "book", "reservation"],
    answer: "In My dancers, choose from the selected venue's dancers who are Working Now and available for requests. Add the date and time and submit the visit request. Submission is a request for the venue to review; wait for confirmation in Requests.", href: "/vip#vip-plan", sources: ["app/vip/VipPlan.tsx", "src/lib/dancr/vip-dashboard.ts"] },
  { id: "vip-requests", roles: ["vip"], title: "Check, edit or cancel a VIP request", phrases: ["request", "confirmed", "pending", "declined", "cancel", "edit visit", "withdraw"],
    answer: "Requests shows the status of your submitted visits, including pending, confirmed, declined and cancelled. Use the edit or cancellation action offered on the request. A pending request is not confirmed, and availability can change. Ask the venue or support team about a specific decision.", href: "/vip#vip-requests", sources: ["app/vip/VipDashboard.tsx"] },
  { id: "admin-access", roles: admins, title: "Understand admin workspace permissions", phrases: ["permissions", "access", "staff", "role", "missing section", "owner"],
    answer: "Admin owners have all sections. Content reviewers have media approval. Support staff have the inbox and account search. Billing staff have the venue subscription roster. If a needed section is unavailable, ask an admin owner to review your workspace role; the assistant cannot grant access.", sources: ["app/admin/AdminWorkspaceTools.tsx"] },
  { id: "admin-review", roles: ["admin", "reviewer"], title: "Review dancer media", phrases: ["review", "media", "photos", "videos", "approval", "content", "queue"],
    answer: "Use the media review workbench to inspect the submitted item and its current review state. Select a club to narrow the queue. Follow the review controls and record any required correction notes. Changes must be saved before leaving the review or switching clubs. The assistant cannot make approval decisions.", sources: ["app/admin/AdminMediaWorkbench.tsx", "app/admin/AdminClient.tsx"] },
  { id: "admin-support", roles: ["admin", "support"], title: "Reply to a support conversation", phrases: ["support inbox", "reply", "message", "conversation", "ticket"],
    answer: "Open the Support inbox, choose the account's conversation, and use Reply to account. Replies are saved to the conversation and notify the account owner. Check the send confirmation before assuming a reply was delivered. The help assistant's local answers do not create a support conversation unless the user sends a handoff.", sources: ["app/admin/AdminClient.tsx", "src/lib/dancr/support.ts"] },
  { id: "admin-billing", roles: ["admin", "billing"], title: "Find venue subscriptions", phrases: ["billing", "subscription", "payment", "invoice", "charge"],
    answer: "Use the venue subscription roster and select the relevant club. Review the displayed subscription information before taking any billing action. I cannot verify live payments, explain an individual charge or authorize a refund. Send those questions to the team with the club name and relevant dates.", sources: ["app/admin/AdminVenueSubscriptions.tsx"] },
  { id: "admin-clubs", roles: ["admin"], title: "Manage club setup", phrases: ["club setup", "club accounts", "publication", "table qr", "embed", "club request"],
    answer: "Open Clubs to review requests and managed club accounts. Choose the club, follow its setup checklist, and review publication readiness. Table QR codes and website embeds are managed inside the club account. Check that the correct club is selected before saving changes.", sources: ["app/admin/AdminClient.tsx", "app/admin/AdminClubSetupChecklist.tsx"] },
  { id: "admin-people", roles: ["admin", "support"], title: "Find an account", phrases: ["find account", "search account", "search dancer", "people", "user"],
    answer: "Use the admin account search to locate an account and review the returned details. Admin owners also have People management tools. Support access is limited to account search and support conversations. The assistant cannot reveal another account's private details.", sources: ["app/admin/AdminWorkspaceTools.tsx", "app/admin/AdminClient.tsx"] },
  { id: "account-credentials", roles: [...guests, "dancer", ...clubs], title: "Change my password or email", phrases: ["password", "email address", "sign in", "login", "credentials"],
    answer: "Open Account to change your email or password and follow any confirmation steps shown there. If you cannot sign in, use password reset on the sign-in screen. Never send your password, verification code or reset link in a help message.", sources: ["app/dashboard/DashboardShared.tsx", "app/vip/VipAccountPanel.tsx"] },
  { id: "account-pause", roles: ["customer", "dancer", "venue"], title: "Pause or delete my account", phrases: ["pause", "delete", "remove account", "close account", "reactivate"],
    answer: "Account contains the available pause, reactivation and deletion controls. Read the confirmation there before continuing. Club removal requires owner access. This assistant only gives guidance and cannot pause or delete your account.", sources: ["app/dashboard/DashboardShared.tsx"] },
  { id: "guides", roles: ["dancer", "venue", ...admins], title: "Read the operating guides", phrases: ["guide", "manual", "training", "instructions", "cheat sheet"],
    answer: "The Guides page has onboarding guides and cheat sheets for eligible accounts. Dancers can access dancer guides; active club owners and managers, and admins, can access the guides their account permits. Sign in with the correct account before opening a document.", href: "/guides", sources: ["src/lib/dancr/operations-guides.ts"] },
  { id: "human", roles: everyone, title: "Contact a person", phrases: ["human", "person", "agent", "contact support", "contact admin", "talk to someone", "not helpful"],
    answer: "Choose Send to the team below to review your question and any details before sending. For admin accounts, Open email prepares a message to the MyDancr support address; you send it from your email app. This is an asynchronous handoff, so a response is not immediate.", sources: ["app/api/support/route.ts", "src/lib/dancr/operations-guides.ts"] },
];

export const helpTopicsFor = (role: HelpRole) => HELP_TOPICS.filter(topic => topic.roles.includes(role));
const normalize = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stopWords = new Set("a an the i my me we our you your how what where when why can do does is are to for of on in it this that and or with from at as be please help want need change get about have has am not cant dont im".split(" "));
const words = (text: string) => new Set(normalize(text).split(" ").filter(word => word && !stopWords.has(word)));
export type HelpMatch = { kind: "answer"; topic: Topic } | { kind: "suggestions"; topics: Topic[] } | { kind: "unknown" };

// Deliberately bounded retrieval: no generated answers, network requests, or live account access.
export function matchHelpQuestion(role: HelpRole, question: string): HelpMatch {
  const query = normalize(question).slice(0, 600);
  if (!query) return { kind: "unknown" };
  // Individual decisions and sensitive data need a human, even if a feature keyword matches.
  if (/\b(refund|charged twice|stolen|hacked|emergency|harassment|abuse|lawsuit)\b/.test(query)
    || /\bwhy\b.*\b(rejected|declined|suspended|banned|charged)\b/.test(query)
    || /\b(show|give|tell|reveal)\b.*\b(password|token|secret|someone elses|another users)\b/.test(query)) return { kind: "unknown" };
  const queryWords = words(query);
  const scored = helpTopicsFor(role).map(topic => {
    const keywords = words([topic.title, ...topic.phrases].join(" "));
    const hits = [...queryWords].filter(word => keywords.has(word)).length;
    const exactTitle = query === normalize(topic.title);
    const phrases = topic.phrases.filter(phrase => (` ${query} `).includes(` ${normalize(phrase)} `));
    const longest = Math.max(0, ...phrases.map(phrase => words(phrase).size));
    return { topic, score: exactTitle ? 100 : hits + longest * 3, hits, coverage: hits / Math.max(1, queryWords.size), longest };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 4 || best.coverage < .25) return { kind: "unknown" };
  if ((best.score === 100 || best.coverage >= .5 || best.longest >= 2) && (!scored[1] || best.score - scored[1].score >= 3)) return { kind: "answer", topic: best.topic };
  return { kind: "suggestions", topics: scored.filter(item => item.score >= 4).slice(0, 3).map(item => item.topic) };
}

export function helpSupportRole(role: HelpRole) {
  if (role === "customer" || role === "vip") return "customer";
  if (role === "venue" || role === "staff") return "venue";
  return role === "dancer" ? "dancer" : null;
}
export function helpSupportHref(role: HelpRole) {
  const accountRole = helpSupportRole(role);
  return accountRole ? `/dashboard/${accountRole}?help=support#${accountRole}-support` : null;
}
export function helpEmailHref(role: HelpRole, message: string) {
  return `mailto:${OPERATIONS_SUPPORT_EMAIL}?subject=${encodeURIComponent(`${HELP_ROLE_LABELS[role]} dashboard help`)}&body=${encodeURIComponent(message.slice(0, 4000))}`;
}
