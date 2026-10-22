"""Newly authored 21 October 2026 operations edition; no legacy manual input."""
EDITION = '21 October 2026'
ROLES = {
 'club-admin': ('Club Admin Team', 'Club_Admin', 'Own the club setup, access, publication and operating controls.'),
 'manager': ('Managers and Talent Management', 'Manager_Talent', 'Run the floor, coordinate guests and dancers, and hand over every open item.'),
 'dancer': ('Dancers', 'Dancer', 'Create your profile, control your visibility and manage your shift.'),
 'content-approval': ('Content Approval Manager', 'Content_Approval', 'Review each release and confirm where approved content appears.'),
}
TASKS = []
def task(code, role, title, route, purpose, shot, controls, steps, done, recovery):
    TASKS.append(dict(code=code, role=role, title=title, route=route, purpose=purpose,
                      shot=shot, controls=controls, steps=steps, done=done, recovery=recovery))

task('A01','club-admin','Set up the club operating team','Club sign in > Dashboard > Manage venue > Team & activity',
 'The club owner assigns access and names a duty manager and content reviewer. “Club Admin” is an operating responsibility; it is not the platform admin login.',
 'team-invite',['Team member email','Access level','Invite team member'],[
 'Sign in with the club account and confirm the club name. Owners have full club access; managers and staff use their own invitations and logins.',
 'Write down the primary owner, duty manager, content approval manager and backup. The reviewer needs owner or manager access; the app has no separate content-reviewer role.',
 'Enter the team member’s email [1]. Use an address that is not already registered as a guest or dancer account.',
 'Choose Manager or Staff [2]. Managers can manage dancer access, review media and request deal changes. Staff have narrower floor and sticker-support access.',
 'Select Invite team member [3]. Confirm whether email delivery succeeded. If the invitation is saved but email failed, use Copy secure link and share it privately with the intended person.'
 ],'The invitation appears in Pending invitations, and the recipient can accept it with the intended email. Record the assigned duty separately from the access level.',
 'An invitation cannot grant owner access. If the email belongs to another account type or the club is wrong, stop and ask MyDancr support to resolve it.')

task('A02','club-admin','Maintain access and offboard team members','Manage venue > Team & activity',
 'Only the owner can invite or remove team members or change their access levels. Managers can review team activity but cannot administer membership.',
 'team',['Member access level','Remove'],[
 'Open Active team and match the person’s name and email before changing anything. Do not share the owner account for shift coverage.',
 'Use the member’s access-level selector [1] to change Manager or Staff. Wait for the saved confirmation and check the displayed role.',
 'For someone leaving the team, select Remove [2] and confirm the named person. Removing access is different from deleting their personal account.',
 'Check Pending invitations and use Revoke for an unused or mistakenly addressed invitation. Reissue a new invitation if a valid recipient needs fresh access.',
 'Review Recent activity after access changes. Transfer unresolved guest, media, sticker and support work to the replacement duty holder.'
 ],'Only current workers retain the required access; invitation and activity records match the change.',
 'If the update fails, refresh and recheck the member before retrying. A failed refresh is not evidence that removal succeeded. Escalate unexplained access immediately.')

task('A03','club-admin','Review and publish the club page','Manage venue > Club page & offers > Venue page review',
 'MyDancr prepares the venue information and commercial package. The club’s authorized reviewer checks it before an owner or manager makes the page live.',
 'publication',['Need changes','Request changes','Preview customer experience','Approve & make live'],[
 'Read the official name, address, phone, website, opening hours, offer, subscription model and guest terms. Match them against the club’s approved information.',
 'If anything is wrong, enter a specific correction in Need changes [1], then Request changes [2]. The form requires at least 10 characters; explain the corrected fact.',
 'When the revised package is ready, open Preview customer experience [3]. Check the logo, venue card, offer and customer page. Send the exact revision to the content approval manager.',
 'Record the reviewer’s sign-off. Select Approve & make live [4] only when the package and terms are correct, then read and accept the publication confirmation.',
 'Wait for the saved result, use Open live venue page when available, and check the public club entry. A published club also needs an active Club Deal to remain visible.'
 ],'The dashboard shows the live venue and the correct public page. Store the release decision in the sign-off log in C09.',
 'A private draft or changes-in-progress state is not live. If the page is hidden because no deal is active, coordinate an approved deal with MyDancr; do not repeat page approval.')

task('A04','club-admin','Request and retire Club Deals','Manage venue > Current Club Deals > Manage deals',
 'Owners and managers request changes; MyDancr reviews and publishes the commercial offer. Sending a request does not immediately change a live deal.',
 'deals',['Request a new deal','Request deal removal','Guest terms'],[
 'Open Guest terms [3] on each current offer. Check its Live or Inactive label, offer description, exclusions and arrival conditions.',
 'Select Request a new deal [1], choose the requested offer and enter dates, hours, exclusions or other details. Obtain content and commercial sign-off before submitting.',
 'Select Send request to MyDancr. Wait for Request sent successfully and check the request history. Keep the request reference for follow-up.',
 'For a retirement, select Request deal removal [2], choose the exact deal, add the reason and send the removal request. Existing deals remain until approval.',
 'After MyDancr completes the change, reopen the current deal and public offer. Tell the duty manager which terms now apply and when they take effect.'
 ],'The requested change has a recorded status, and the final public offer matches the approved terms.',
 'Removing the last active deal hides the venue and its dancer schedules; dancer profiles and TV stay live and affiliations remain saved. Arrange replacement terms before a planned removal.')

task('A05','club-admin','Arrange and place table QR signs','Club team coordinates with MyDancr admin > Clubs > Table QR codes',
 'MyDancr platform admins create and manage table QR codes. The club supplies table labels, receives the signs and verifies placement. Table QR signs and dancer NFC stickers serve different purposes.',
 'table-qr',['Number range','Create QR code','Print QR sign','Disable'],[
 'Give MyDancr the exact club and table list, including separate rooms or duplicate numbering. Agree which sign belongs at each location.',
 'Platform admin only: open the venue’s Table QR codes. Use Single table and Create QR code [2], or Number range [1] for a numbered batch. Check existing labels first.',
 'Platform admin only: use Print QR sign [3], Print all or Download QR. Check the club identity and table label on the output before distributing it.',
 'Club team: compare each delivered sign with its physical table. Open its link with a phone camera and confirm the intended club/table display without submitting a sample request.',
 'If a sign is lost, moved or wrong, remove it from use and request correction. A platform admin can Rename, replace or Disable [4] the code as appropriate.'
 ],'The placement register matches every installed sign. Guests can identify their table and see the participating internal roster.',
 'Do not place dressing-room NFC links on guest tables. Do not relabel a physical table while leaving a different active QR label. Send the sign reference to support.')

task('A06','club-admin','Maintain dancer tap stickers','Dancers & tables > Dancer & legacy stickers',
 'Dressing-room stickers connect dancer profiles and start eligible Working Now sessions. Club staff can inspect assigned inventory and request support; MyDancr administers sticker provisioning.',
 'stickers',['Test','Support'],[
 'Open the assigned sticker inventory and confirm the label, type, status and intended physical location. Keep dancer check-in stickers in the designated staff area.',
 'For a reported failure, ask for the device type, sticker label, time and exact message. Check whether the dancer is still completing setup, awaiting approval or in cooldown.',
 'When a controlled tap check is appropriate, select Test [1] and follow the listening status. A real dancer tap can affect enrollment or Working Now; coordinate it with that dancer.',
 'Select Support [2], choose Damaged, Lost, Needs to move or Replacement needed, and describe the location and symptom. Select Send request and retain the confirmation.',
 'Replace or relocate a sticker only after MyDancr confirms the assignment. Tell managers which stickers are unavailable and how to handle affected dancers.'
 ],'Every sticker is accounted for and any issue has an owner and support reference.',
 'A repeat tap does not extend an active session or override cooldown. Never substitute a guest table QR for the dancer check-in sticker.')

task('A07','club-admin','Publish the website grid and use TV','Manage venue > Website grid and MyDancr TV',
 'The website embed displays MyDancr content on the club’s external website. A copied embed does not replace media approval, dancer consent or the club’s publishing sign-off.',
 'website',['Preview website grid','Copy preview link','Copy embed code'],[
 'Open Preview website grid [1] and check the club identity, colors and approved dancer profiles with the content reviewer.',
 'Use Copy preview link [2] to provide the exact preview for review. Record the destination website and page in the release log.',
 'After sign-off, use Copy embed code [3] and give the complete code to the authorized website editor. They insert it in the site’s HTML/embed area and publish that website change.',
 'Check the published external page on a phone and a desktop. Open a dancer profile and confirm its approved media, visibility and correct club association.',
 'Use MyDancr TV in Manage venue to open the club’s TV selection. Verify the selected club/city and approved videos; the launcher is not an upload or approval control.'
 ],'The intended external page and TV view show the correct approved content. Record checks for each destination separately.',
 'If copying is blocked, select and copy the text the app provides. Empty grids may reflect visibility, check-in or publication status; follow C07 before changing embed code.')

task('A08','club-admin','Configure alerts and support coverage','Manage venue > Notification preferences and Account & support',
 'Assign someone to watch the operational queues even when notifications are enabled. Preferences and phone delivery are separate controls.',
 'club-notifications',['Notification switch'],[
 'Open notification preferences with your own club login. Enable the overall alerts setting and the categories your duty requires, especially table, VIP, pickup, media and support events.',
 'Choose email and phone push delivery where available. For push, follow the device permission prompt and check any browser support guidance shown.',
 'Change one setting at a time and wait for its saved confirmation. Reopen the panel if the session changes or the setting cannot be confirmed.',
 'Open Account & support for technical issues. Enter a clear subject and message with club, affected role, record reference, time, action and exact error.',
 'Assign an owner for follow-up and check support replies at handover. Contact the duty manager directly for an issue affecting the current shift.'
 ],'The responsible people know their queues, delivery settings and backup contact. Support requests have enough context to investigate.',
 'If alerts stop, check account preferences, device permission and the queue directly. Do not include passwords, invitation tokens or identity documents in support messages.')

task('A09','club-admin','Review club results and commercial records','Results > period and metric categories',
 'Use recorded activity to manage the club. Club subscriptions are separate from guest counts; a pass claim is not the same as a verified admission.',
 'results',['Roster activity','Guest list and entries','Dancer contribution'],[
 'Select Tonight, 7 days, 30 days or All time in Results. Note the displayed period and club time zone before comparing reports.',
 'Open Roster activity [1] to examine check-ins, hours and checkout accuracy. Investigate an operational pattern with the duty manager before changing staffing.',
 'Open Guest list & entries [2]. Keep signups, claimed passes and verified entries distinct; do not add overlapping measures together as unique customers.',
 'Review VIP, table, transportation, customer-interest and Dancer contribution [3] categories. Treat requests as demand signals, not proof that a visit or service occurred.',
 'For subscription questions, give MyDancr the club and agreement reference. Authorized platform admins use the Venue subscription roster; club request history is not a billing payment screen.'
 ],'Your management notes identify the reporting window, relevant measures, exceptions and assigned follow-ups.',
 'A dash or unavailable message is not zero. Refresh the affected report and retain the last confirmed timestamp. Escalate missing data rather than inventing totals.')

task('A10','club-admin','Pause accounts or end club participation','Manage venue > Account & support',
 'Account controls and removal of the club have different effects. Only the owner can end club participation. Prepare the operational handover before using a destructive control.',
 'club-removal',['Keep club on MyDancr','Confirm club removal'],[
 'Decide whether the issue is an individual login, a temporary account pause or an intentional end to the club’s participation. Review the current on-screen explanation.',
 'Before closing participation, resolve guest commitments, assign support cases, notify the team through the club’s normal channels and arrange removal of physical signs.',
 'If the club is staying, select Keep club on MyDancr [1]. For an authorized closure, the owner selects Remove club from MyDancr and reviews the consequences.',
 'Use Confirm club removal [2] only for the intended club. This ends the listing, affiliations and check-ins and stops the club’s tap stickers.',
 'Read the completion message and verify the closed state. Dancers keep their accounts and media. Returning requires a new agreement with MyDancr.'
 ],'The chosen account or participation change is confirmed, and the club’s physical and online operating materials reflect it.',
 'Do not use removal to fix a missing deal, upload delay or login issue. If the result is uncertain, refresh the status and contact support before repeating the action.')

task('M01','manager','Open the shift workspace','Club dashboard > Tonight',
 'The duty manager coordinates real floor activity with the app. Start with the correct club, current information and named coverage for each queue.',
 'tonight',['Working now','Table requests','Guest list','VIP requests','Ride requests'],[
 'Sign in with your own club team login. Confirm the club identity and use the dashboard Refresh control. Read any failed-load or stale-data message.',
 'Open Working now [1] and compare the displayed roster with the floor team. Identify dancers still setting up, awaiting media review or deliberately absent from one channel.',
 'Review Table requests [2], Guest list [3], VIP requests [4] and Ride requests [5]. Assign someone to each open item and confirm who covers breaks.',
 'Check Dancers & tables > Media approvals with the assigned reviewer. Do not promise that a pending upload or newly enrolled dancer is already public.',
 'Read the prior handover, current Club Deal terms and sticker issues. Record unresolved items and agree the next check time.'
 ],'The shift has a confirmed roster, queue coverage and a short list of exceptions with owners.',
 'If a queue is unavailable, contact the duty manager/owner and use the club’s agreed continuity process. Reconcile records after service returns; avoid duplicate submissions.')

task('M02','manager','Find dancers and manage affiliation','Dancers & tables > Dancer roster',
 'Affiliation authorizes a club relationship; Working Now represents a current check-in. Internal and external channel choices can make the same roster look different.',
 'roster',['Search dancers','Working now','External'],[
 'Search the stage name [1] and use Name A-Z or Z-A. Choose All affiliated to find an authorized dancer even when they are not working.',
 'Choose Working now [2] for active check-ins, then All channels, Internal or External [3] to inspect the relevant audience.',
 'Open the dancer card/profile and its details menu to check identity and status. Managers should confirm availability directly before assigning a guest request.',
 'When a dancer leaves, ask them to use Overview > End Working Now and confirm the result. Escalate a stale session if they cannot end it; this roster menu does not provide an end-check-in button.',
 'For a club access removal, an owner/manager uses Remove access in the dancer details menu and confirms the effect on Internal and External. Use Removed dancers > Allow new tap only after the club authorizes a return.'
 ],'The roster accurately distinguishes affiliation, active presence and channel visibility.',
 'A missing dancer may need approval, a valid tap or another visibility choice. Do not remove and recreate access simply to refresh a card; check the cause first.')

task('M03','manager','Handle a table request from start to finish','Dancers & tables > Table requests > request details menu',
 'A table request is a request to staff. Marking it seen does not guarantee dancer availability or mean the dancer has arrived.',
 'table-requests',['Mark seen','Dismiss'],[
 'Open the request’s details menu and verify table, dancer and received time. Separate any visibly labeled sample cards from live guest work.',
 'Select Mark seen [1] after a staff member has taken responsibility. Contact the dancer and confirm availability through normal floor communication.',
 'When the dancer actually reaches the table, reopen the acknowledged request and select Mark arrived. If they did not arrive, record Didn’t arrive at table.',
 'After an arrived request is finished, select Complete. Use Dismiss [2] for a cancelled or invalid request, following the club’s guest-handling process.',
 'Refresh and verify the saved state before moving on. Tell the next manager about every unresolved table request at handover.'
 ],'The record reflects seen, arrival and completion events accurately, with a named staff owner while it is open.',
 'If another employee already changed the request, reload and use the current state. Do not repeatedly submit an old action or infer arrival from acknowledgement.')

task('M04','manager','Find guests and understand admission status','Tonight > Guest list',
 'The club dashboard displays guest-list records. It does not scan passes or admit guests inside this panel; the club’s door admission workflow is separate.',
 'guest-list',['Visit date','Find a guest','Search','Awaiting admission'],[
 'Choose Tonight, Choose a date or All active passes [1]. If choosing a date, complete the date field. Read the club time zone shown.',
 'Enter a name, phone or email [2] and select Search [3]. Use Clear or Clear filters if a record is unexpectedly absent.',
 'Select Awaiting admission [4], Admitted or All. All can include expired passes; expand a guest record to inspect contact details and validity times.',
 'Direct door staff to the authorized pass admission process. In that separate flow, they check the current offer and arrival requirements before recording admission.',
 'After a valid admission is recorded, Refresh guest list and confirm the guest’s status. Load more guests when the record is beyond the current page.'
 ],'The correct guest and visit date are identified, and the manager understands whether admission has been recorded.',
 'If refresh fails, the app may retain the last loaded list and say so. Do not treat cached Awaiting admission as proof that the guest has not already entered.')

task('M05','manager','Invite and manage VIP guests','Tonight > VIP access > Invitations and VIP guests',
 'VIP access is invitation-based. It lets a guest request visits and dancers; it does not automatically confirm a visit.',
 'vip-invite',['Guest email','Send invitation','VIP guests'],[
 'Select Invite guest, enter the intended guest email [1] and optionally a private nickname that helps your team identify them.',
 'Select Send invitation [2]. Check the delivery message. If email could not be sent, use Copy private link or Share invitation and share it only with the invited guest.',
 'Explain that the invitation is valid for seven days and only the invited email can use it. Confirm the guest knows how to activate the account.',
 'Use VIP guests [3] to search members. In the options menu, Add/Edit nickname or Remove VIP access when authorized. Nicknames are private to venue owners and managers.',
 'In Pending invitations, use Resend email, New share link or Revoke invitation as needed. Resending or generating a new link replaces the previous unused link.'
 ],'The invitation or membership is visible in the intended club, and the guest has the current private link.',
 'If activation fails, check email, expiry and whether a newer link replaced the old one. Removing VIP access preserves existing requests for review.')

task('M06','manager','Review and respond to VIP visit requests','Tonight > VIP access > Requests',
 'Confirm a request only after checking the visit time, guest details and dancer availability. The app notifies the VIP when the request decision is saved.',
 'vip-requests',['Add message','Confirm request','Decline'],[
 'Open Pending requests. Review the requested date/time and displayed time zone, requested dancers, guest notes and any private nickname.',
 'Check availability with the floor/talent team. A requested dancer is not a confirmed booking just because their name appears in the request.',
 'Use Add message [1] for a clear response, such as meeting instructions or an explanation of unavailable choices. Keep it suitable for the VIP to read.',
 'Select Confirm request [2] or Decline [3]. Wait for the saved result and confirm the request status; use All statuses to find previous visits.',
 'For an already confirmed visit that must be cancelled, reopen it and use Cancel confirmed request with an appropriate message. Update the duty manager and guest coordination plan.'
 ],'The request has the correct decision and response, and the operating team knows the agreed arrangements.',
 'If a concurrent update is reported, reload the current request before deciding. Do not promise a dancer, time or exception you have not verified.')

task('M07','manager','Coordinate ride requests','Tonight > Ride requests',
 'Ride statuses track staff handling. A ride request does not automatically dispatch transport or guarantee a pickup.',
 'rides',['Show rides','Call guest','Ride status'],[
 'Use Show rides [1] to review Open requests from the last 48 hours, All requests, Completed or Cancelled.',
 'Read the request details, time and contact information. Select Call guest [2] when appropriate and confirm pickup location, party details and arrival requirements.',
 'Coordinate transport through the club’s authorized dispatch process. Change Ride status [3] to Contacted after contact and Arranged after transport is actually arranged.',
 'Record Completed after the ride is finished, or Cancelled if it will not proceed. Wait for confirmation before telling another worker the record is updated.',
 'Use Load older requests for historical follow-up and hand over any still-open ride with its last contact and next action.'
 ],'The status reflects the real transport arrangement and an employee owns each open request.',
 'If the guest cannot be reached, leave the record in an accurate open state and follow club policy. Refresh after a conflict before retrying a status change.')

task('M08','manager','Use shared contacts appropriately','Tonight > Contacts',
 'Contacts distinguish details shared for a visit from active club email/text subscriptions. A guest’s presence in the list is not permission for every type of message.',
 'contacts',['Email updates','Text updates','Contact and sharing details'],[
 'Search names and choose Shared contacts, Shared followers or Guest list to understand how the contact reached the club.',
 'Use Email updates [1] or Text updates [2] to find the corresponding currently subscribed group. Recheck the relevant badge before using those details for that channel.',
 'Expand Contact & sharing details [3]. Read Shared for, provided contact fields and any opt-in timestamps. “Not shared” means that field is unavailable to the club.',
 'Use visit-only details to coordinate the relevant visit. Do not treat a follow, pass claim or private follower count as a general marketing subscription.',
 'Keep contact information inside authorized club processes. Escalate an access or privacy discrepancy to the owner and MyDancr support with the record reference.'
 ],'Staff use the contact for the purpose and delivery channel actually recorded.',
 'If the expected contact is missing, clear the search and check the source filter. An empty shared list can coexist with private followers counted in Results.')

task('M09','manager','Close the shift and hand over','Tonight, Dancers & tables, Results and support',
 'A good handover records open obligations and confirmed outcomes, rather than treating every queue count as completed work.',
 'club-navigation',['Tonight','Dancers and tables','Results','Manage venue'],[
 'Revisit Tonight [1] and list unresolved VIP, ride and guest issues with guest/reference, last action, next step and named owner.',
 'In Dancers & tables [2], finish accurate table states and check departing dancers. Record failed stickers, pending approvals and any club access restriction.',
 'Open Results [3] for the same shift/period and time zone. Compare verified entries, requests, check-ins and checkouts without combining unlike counts.',
 'In Manage venue [4], check deal changes and support replies. Transfer promised corrections and external website work to the responsible person.',
 'Write the handover time, incoming manager and next review time. Sign out of shared devices and close private guest/profile screens.'
 ],'Every unfinished obligation has an owner, reference and next action; the incoming manager can resume without guessing.',
 'If data was unavailable, label the timestamp and unverified items. Reconcile after recovery and avoid duplicating a request or claiming it was completed.')

task('D01','dancer','Create your account and identity','Dancer sign in > Profile > Name & city',
 'Use your own dancer account. Your stage name and city identify the profile; they do not replace the club tap or age verification.',
 'identity',['Stage name','City','Save control'],[
 'Choose dancer account creation or dancer sign in. Use your own email and password, complete any email verification prompt, and keep access to that email.',
 'Enter your stage name [1] and select an available city [2]. The stage name requires 2 to 40 characters. Check spelling before continuing.',
 'Save using the displayed Save/Continue control [3]. In the guided editor, continue from Name & city to Photos & videos.',
 'Add the required main photo and at least three profile photos in total, including the main photo. Your avatar is created from your main photo and does not add a gallery slot.',
 'Continue to the Dancer Agreement, complete age verification, then tap the club’s dressing-room sticker. The next pages explain each stage.'
 ],'Your identity is saved and the setup checklist shows the next required step.',
 'If cities fail to load, use the offered retry and wait before saving. For a forgotten password, use the sign-in recovery control rather than creating a second profile.')

task('D02','dancer','Set the main photo and avatar','Profile > Main photo and Avatar',
 'Your main photo appears on eligible cards and helps generate your avatar. Replacing a photo submits new media for review; a successful upload is not publication.',
 'main-photo',['Add main photo'],[
 'Select Add [1] in Main photo, or Change/Replace when a photo already exists. Choose a solo image of yourself that follows the photo rules.',
 'Use the crop controls to frame the image and save the crop when prompted. Keep your face clear and avoid cutting off important details.',
 'Wait until upload and processing finish. Keep the page open while it reports work in progress. Read Pending, Approved or any rejection notice.',
 'Check the automatically created Avatar. Adjust its crop if needed. The avatar is separate from the minimum profile-photo count.',
 'Where available, Choose uploaded photo lets you select an existing eligible photo as main. Verify the final main-photo selection and the profile after review.'
 ],'The correct main image is saved with a clear review status; the avatar crop identifies you accurately.',
 'If upload fails, use Retry main photo upload after checking connection and file limits. If the main photo is rejected, correct the stated issue and replace it.')

task('D03','dancer','Upload and maintain profile photos','Profile > Photos & videos > Add photos',
 'The profile supports up to 50 photos. Initial setup requires at least three submitted profile photos including a main photo; pending uploads count for setup, not public approval.',
 'photo-upload',['Gallery photo picker'],[
 'Open Add photos. Use Gallery [1] for existing images or Camera to take a new one. Supported uploads are JPEG, PNG, WebP, HEIC or HEIF, up to 25 MB each.',
 'Choose solo images of yourself and review the visible Photo rules. Check backgrounds, reflections, contact details and branding before selecting files.',
 'Follow the upload/crop prompts. Watch each item’s progress and use Retry only for a failed item; avoid reselecting a batch that already uploaded.',
 'In the media library, inspect the status of each photo. Use the available crop, pin, replacement or removal controls on the intended item, then confirm the result.',
 'Keep the required main photo and enough valid photos for activation. Ask the assigned club reviewer about pending or rejected items and follow the correction note.'
 ],'Your photo count and review statuses are correct, and only approved photos appear to the permitted audience.',
 'If an image is rejected, replacing it creates a new version that needs review. Do not assume removing a pending replacement also removes a previously approved image; check the library.')

task('D04','dancer','Accept the agreement and verify your age','Setup > Dancer Agreement > Verify you are 18 or older',
 'Complete your profile submission and the current agreement before your first club tap. Age verification uses the app’s Ondato flow.',
 'verify-age',['Verification acknowledgement','Verify age','Check verification status'],[
 'Open and read the Dancer Agreement from the setup screen. Select its agreement checkbox only after reading it, then use the displayed Continue/Submit control.',
 'Have a valid photo ID ready. On Verify you’re 18+, read the explanation and acknowledge that you will continue to Ondato [1].',
 'Select Verify age [2]. In Ondato, follow the ID photo and live-selfie instructions using your own documents and identity.',
 'Return to MyDancr and select Check verification status [3]. If the session is unfinished, use Continue verification; if expired, start a new session as prompted.',
 'Wait for a verified result before the club tap. An In review result needs time or support, not repeated attempts to bypass it.'
 ],'The current agreement acceptance is saved and age status is verified. MyDancr says it stores the result, not your ID photos, selfie or date of birth.',
 'For a declined or stalled result, read the exact message and contact support. Do not email ID photos or ask another dancer to complete verification for you.')

task('D05','dancer','Connect to the club and activate','Setup > Confirm your club > dressing-room NFC sticker',
 'The first eligible tap connects pending media to the club’s review queue. Profile activation and a current Working Now session are related but distinct states.',
 'nfc-activation',['Check activation status','Ready to tap or check-in help'],[
 'Finish identity, the main photo and minimum photos, agreement acceptance and required age verification before visiting the sticker.',
 'At the club, unlock your phone, tap the designated dressing-room NFC sticker and open the link. Sign in with your dancer account if prompted.',
 'Read the club identity and choose the offered visibility option. Submit the tap flow once and read its result.',
 'If the app says Tap saved - awaiting club approval, tell the assigned reviewer. Your required media must be approved before activation can complete.',
 'Use Check activation status [1] after the club reviews your uploads. Once activated, verify whether you have an active Working Now session; follow the next permitted tap instructions if needed.'
 ],'The app confirms activation/venue access and, separately, the current check-in state.',
 'A saved tap does not mean public content is already approved. If the club is wrong, the sticker fails or setup is blocked, contact the duty manager with the exact message.')

task('D06','dancer','Start and end Working Now','Dressing-room NFC tap > Overview > Working Now',
 'A valid tap starts a six-hour Working Now window, followed by a six-hour cooldown across all clubs. Another tap does not extend the window.',
 'working-now',['End Working Now'],[
 'Tap the current club’s dressing-room sticker and choose Internal only, External only or Both. Read the returned club and status before leaving the tap screen.',
 'Internal only shows you on that club’s internal roster; External only shows your full public profile without the internal roster; Both allows both audiences. Full approved profile requirements still apply.',
 'In Overview, check Working Now and the displayed end time. Switch to Both is offered only for eligible internal sessions with recorded external time. Otherwise choose the audience at your next eligible tap.',
 'When leaving early, select End Working Now [1], review the confirmation, and select Yes, end now. Keep working cancels the change.',
 'Confirm the inactive status. Ending early does not remove the tap cooldown; check the next allowed tap time before trying again at this or another club.'
 ],'The shown club, audience and Working Now status match your actual shift.',
 'If a tap is blocked, check setup, age, club access and cooldown messages. Ask the manager to inspect a wrong or stale roster rather than repeatedly tapping.')

task('D07','dancer','Control visibility and share your profile','Profile > Visibility & sharing',
 'Profile visibility is separate from your club check-in. Incognito hides your profile and content while keeping them saved.',
 'visibility',['Go incognito or Make profile public'],[
 'Open Visibility & sharing and read Public/Visible or Incognito/Hidden before making a change.',
 'Select Go incognito [1] to hide the profile, or Make profile public to request the public state. Wait for Saved; do not navigate away while saving.',
 'Check the displayed result and the intended audience. Being public does not create a club check-in or approve pending media.',
 'Use Share profile to copy the profile link. Share only the intended public link and check the destination before distributing it.',
 'When returning from incognito, recheck required approvals and your current Working Now/channel choices. Ask the reviewer or manager if a destination remains empty.'
 ],'Your saved visibility matches your intention, and the share link opens the expected permitted profile.',
 'If the app cannot verify the visibility change, refresh and recheck before sharing. Ending Working Now, removing club access and going incognito are different actions.')

task('D08','dancer','Upload and manage videos','Profile > Photos & videos > Add videos',
 'You can keep up to 50 profile videos. Uploaded video output is limited to 30 seconds and 25 MB. Video publication requires review and processing.',
 'video-upload',['Confirm permissions','Choose video','Record video'],[
 'Open Add videos and read Video rules. Confirm both permissions [1]: only you appear, and you own or have permission for all visuals and audio, including music.',
 'Use Choose video [2] for a saved MP4, WebM or MOV, or Record video [3]. Follow the trimming/cropping prompts and the displayed limits.',
 'Wait for upload and checking to finish. Keep the page open and inspect each selected video’s progress. Do not upload duplicates while the first copy processes.',
 'Read the status and reviewer note. Approved media can appear only where your profile and audience settings allow; pending media stays under review.',
 'Use the intended video’s Replace, Remove or pin control when available. A replacement is a new review item. Verify the library and TV/profile after an approved change.'
 ],'Each video has a known status and only the approved version is released to its permitted destination.',
 'For a failed upload, use that item’s Retry. For a rejection, correct the footage or rights issue; do not keep submitting the unchanged file.')

task('D09','dancer','Review requests and performance','Dancer dashboard > Results',
 'Results helps you understand requests and audience activity. Staff coordinate club table and VIP requests; a number in your results is not a guaranteed assignment.',
 'dancer-results',['Tonight','7 days','Club filter'],[
 'Open Results in the dancer dashboard. Choose This shift, Tonight, 7 days, 30 days or All time when available and note the period/time zone.',
 'Review the In club, VIP and Public site views. Select a club where that filter is offered so you compare the same audience and location.',
 'Open request details from the available request metrics. Check the relevant shift/window and ask the duty manager about operational follow-up.',
 'Review audience growth, profile/video views, top content and trends. Use the same reporting window for comparisons and distinguish views from requests or completed visits.',
 'Discuss unusual counts or missed requests with the manager. Include the period, club and record reference in a support report if the data cannot be reconciled.'
 ],'You can explain which audience, period and club the displayed results describe.',
 'If results are loading or unavailable, retry the affected panel. Do not read unavailable values as zero. A current-shift view may fall back to seven days when there is no active shift.')

task('D10','dancer','Manage alerts account access and help','Dancer dashboard > Account',
 'Keep your own login and notification preferences current. Account controls affect access; use profile visibility if the goal is simply to hide saved content.',
 'dancer-notifications',['Activity notification switch'],[
 'Open Account and the notification settings. Set the overall activity-alert preference, then followers, profile likes, photo likes, video likes and shares as needed.',
 'For phone delivery, follow the separate device notification setup. Read the browser guidance and permission result; a category preference alone does not enable phone push.',
 'Use Account & security to review the current account state and any pause/resume or deletion controls. Read the displayed consequences before confirming a permanent change.',
 'For help, use Support with a subject, exact error, time, affected club and upload/request reference. Your club reviewer handles correction notes; the duty manager handles current-shift issues.',
 'To stop a club relationship, open Venue access and select Remove for that club. Read the warning: a future Working Now session there requires a new eligible dressing-room tap.'
 ],'Your settings are saved, the right person owns any open issue, and your account stays accessible to you.',
 'Recover a forgotten password from sign-in. Do not share passwords, verification documents or private invitation links in messages or screenshots.')

task('D11','dancer','Resolve missing or rejected content','Profile media status > club reviewer > Support',
 'Follow the item’s status rather than guessing from the public page. A profile can be active while a new replacement remains pending.',
 'nfc-activation',['Check activation status','Check-in help'],[
 'For a missing setup step, check saved name/city, a main photo, at least three profile photos, current agreement acceptance and required age verification.',
 'For pending club review, confirm the eligible club tap was saved, then ask the assigned reviewer to inspect the queue. Use Check activation status [1] after the decision.',
 'For a rejected item, read the reason and correct the specific issue. Submit a compliant replacement and wait for review; your private upload preview is not proof of publication.',
 'For approved content missing from a destination, check Incognito/Public, current Working Now, Internal/External/Both and the club’s publication state.',
 'For failed processing or an error, record the item, time and exact message. Retry only when the app offers it and send persistent failures to support.'
 ],'The blocker is identified and the next action belongs to you, the club reviewer, the manager or support.',
 'Never use another person’s account, repeatedly retap during cooldown, or resubmit unchanged rejected media as a workaround.')

task('C01','content-approval','Own the release approval process','Assigned owner or manager > Dancers & tables > Media approvals',
 'The content approval manager is an assigned operating duty using owner/manager permissions. This manual requires sign-off before release to any internal or external destination.',
 'media-approval',['AI findings','Review note','Approve','Reject'],[
 'Confirm your assigned club and review authority. Keep a backup reviewer and an escalation contact. Staff access alone cannot perform club media approvals.',
 'Separate the app’s controls: pending dancer photos/videos use Media approvals; initial venue publication uses Approve & make live; MyDancr admins manage published commercial and platform changes.',
 'For text, branding, embeds and other changes without a universal approval queue, require the editor to hold the change as a draft until you record sign-off outside the app.',
 'Review the exact asset/version, its owner and every intended destination: internal roster/full profile, public discovery/profile, club page, external embed and TV.',
 'Record Approved, Changes required or Escalated in the release log. An approval applies only to the reviewed version and named destinations; re-review changed content.'
 ],'Every proposed release has a named reviewer and decision before its publisher acts.',
 'The application does not provide one universal technical hold for every content type. This is an operating control where no hold exists; do not describe a saved edit as awaiting an automatic gate.')

task('C02','content-approval','Find and inspect the review queue','Dancers & tables > Media approvals',
 'New dancers enter the club review queue after their eligible NFC tap. Queue counts and processing messages help distinguish review work from technical preparation.',
 'media-approval',['AI findings','Review note','Approve','Reject'],[
 'Refresh Media approvals and check the club identity. Read the pending count and use Previous/Next when the queue spans more than 12 items.',
 'Match each card to its stage name and media type. Open the full photo or play the video; do not approve solely from a small thumbnail.',
 'Read the automated summary and expand AI findings [1]. Treat these as review assistance and examine the actual content yourself.',
 'If the preview is unavailable, refresh and leave the item pending. If processing is still active, wait; disabled controls are not an invitation to bypass review.',
 'Inspect rights, identity, content rules, visual quality and intended surfaces before using Approve [3] or Reject [4]. Use Review note [2] to record a useful decision explanation.'
 ],'You have inspected the current item and understand whether it is ready for a decision.',
 'If expected media is absent, check the dancer’s setup/tap and correct club assignment. A zero count alone does not prove all of a dancer’s setup requirements are complete.')

task('C03','content-approval','Approve or reject photos','Media approvals > photo card',
 'Apply the app’s current Photo rules to the full image, including backgrounds and reflections. Check main-photo and avatar usability as part of the release.',
 'media-approval',['AI findings','Review note','Approve','Reject'],[
 'Confirm the upload depicts only the adult account holder. Look for other people or minors in mirrors, screens and backgrounds. Escalate identity uncertainty.',
 'Check coverage: bikinis, opaque lingerie, thongs and cleavage are allowed; nipples, areolas, genitals and anus must remain covered. Sexual activity is prohibited.',
 'Check for visible brands/logos/watermarks, contact details, social/payment handles or QR codes. Check the other listed prohibited-content categories in Photo rules.',
 'Confirm the image is usable and the person has rights to publish it. For main photos, check framing and a clear face for the generated avatar.',
 'If compliant, add any useful note [2] and select Approve [3]. If not, enter the specific issue and correction, then Reject [4]. Wait for the saved result.'
 ],'The reviewed photo leaves the pending list with the intended decision. Required photo approvals can help complete activation.',
 'Do not approve an unreadable or unavailable preview. A platform-generated watermark on published output is different from prohibited branding in the uploaded source.')

task('C04','content-approval','Review video and audio before release','Media approvals > video card',
 'Watch the entire clip with sound. A compliant opening frame does not establish that later frames, reflections, speech or music meet the rules.',
 'video-approval',['AI findings','Review note','Approve','Reject'],[
 'Confirm identity and review the entire video for other people, minors, prohibited exposure/activity, contact information, branding and other content-rule violations.',
 'Listen to speech and music. Confirm the uploader has rights to every visual, recording, song, beat and audio element; escalate unclear ownership rather than assuming permission.',
 'Read the AI findings [1] and processing state. Verify that the playable preview is the actual revision you are deciding, with no broken playback or missing sections.',
 'Record a useful Review note [2]. Approve [3] only after all checks pass; otherwise provide a specific correction and Reject [4].',
 'Wait for the save/publishing result. Once approved, verify the profile and any intended TV/external destination under the dancer’s current visibility settings.'
 ],'The complete clip and audio have been reviewed and the publication outcome is confirmed.',
 'A disabled approval control or processing message requires waiting or support. Do not approve an unavailable video or treat an automated summary as the full human review.')

task('C05','content-approval','Return corrections and resolve review conflicts','Media approvals > Review note',
 'A rejection must tell the dancer what to change. A new upload or competing review can invalidate the version currently on your screen.',
 'media-approval',['AI findings','Review note','Approve','Reject'],[
 'Describe the issue in Review note [2] with a concrete correction, such as “Another person is visible in the mirror; replace with a solo image.” Avoid vague “bad content” notes.',
 'Select Reject [4]. The app requires a reason of at least three characters; write enough detail to make a corrected submission possible.',
 'Confirm the saved rejection and queue update. Tell the dancer through the agreed club process where to read the note and how to submit a replacement.',
 'Treat the replacement as a new version. Inspect the entire corrected asset, not only the part mentioned in the original note.',
 'If the app reports the item changed, another reviewer acted or the decision failed, refresh the queue and inspect the current item before trying again.'
 ],'The decision is saved against the reviewed version, and the dancer has actionable instructions.',
 'Do not repeatedly click while Publishing approved media or Saving review is shown. If the outcome is uncertain, refresh and reconcile before repeating the decision.')

task('C06','content-approval','Approve club text offers branding and embeds','Draft or preview > release log > authorized publisher',
 'Content outside dancer media still needs review before release. Some app edits can publish directly, so the responsible editor must wait for your sign-off.',
 'publication',['Correction note','Request changes','Customer preview','Approve and publish'],[
 'Collect the exact proposed club name, address, phone, hours, website, logo, colors, offer text and terms. Identify every internal/external destination affected.',
 'Compare factual and commercial claims against the club’s approved information. Check expiry dates, exclusions, arrival conditions, link destinations and readability.',
 'For a prepared venue page, use the customer preview [3]. Return corrections through the notes [1] and Request changes [2] before the publication action.',
 'For later edits, website embeds or platform content, record the proposed version and destination in C09. Require the editor to hold publication until your Approved decision is recorded.',
 'Have the authorized owner/manager or MyDancr admin publish the approved change. Review the resulting destination and mark release verification separately from approval.'
 ],'The exact approved text and assets are live in the intended places, with a recorded publisher and verification result.',
 'If a publisher changes the content after sign-off, stop release and review the new version. An approval for one channel does not automatically cover another.')

task('C07','content-approval','Verify internal external and TV publication','Internal roster, public profile, club page, external website and TV',
 'Approval is one condition for visibility. Check the intended audience and current state separately for each destination.',
 'website',['Preview website grid','Copy preview link','Copy embed code'],[
 'For internal content, use the club’s internal roster/full profile. Confirm active club presence, the Internal/Both selection and the expected approved image/video.',
 'For public discovery and dancer profiles, verify Public rather than Incognito, external eligibility and the approved version. A current club label depends on current presence.',
 'For the club page, verify its publication status and an active Club Deal. Use the public Refresh control where shown to load current club information.',
 'For the external club website, inspect both Preview website grid [1] and the actual published website. Open a profile and check media, branding and layout.',
 'For TV, open the intended city/club selection and verify the approved clip. Record pass/fail and time for each destination in the release log.'
 ],'Every intended destination has a recorded post-publication check; unapproved versions and unintended audiences are not exposed.',
 'If one surface is empty, check visibility, presence, affiliation, publication and processing before reapproving or reuploading. Refresh behavior varies; use the relevant page control.')

task('C08','content-approval','Contain a mistaken release or complaint','Duty manager and MyDancr platform support',
 'Act promptly when content was approved incorrectly, published without sign-off or reported for an identity, rights or safety issue. Preserve enough information to investigate.',
 'support',['Subject','Message','Send control'],[
 'Record the affected URL, club/dancer, asset reference, time, destination and specific issue. Keep the evidence in the restricted incident record.',
 'Stop any further release of that version. Ask the authorized dancer/editor to hide or remove it using the relevant content control, or request platform intervention when the club lacks a takedown action.',
 'Contact MyDancr support with Subject [1] and Message [2], or use the established urgent contact. Do not assume Reject in a pending queue can remove already-published media.',
 'For a rights complaint, route the case to the authorized platform team and its DMCA/report workflow. Preserve the decision record and follow the case instructions.',
 'Recheck internal, public, embed and TV destinations after containment. Require a fresh review before any corrected version is released.'
 ],'The issue has an accountable owner, exposure has been checked, and the next review is recorded.',
 'If you cannot remove the content or verify removal, state that clearly to the owner and support. Do not close an incident merely because one page no longer shows it.')

task('C09','content-approval','Record sign off and hand over the queue','Club controlled release log and Media approvals',
 'Use the log below for every release, including changes without an in-app approval queue. Store it in the club’s access-controlled operating records.',
 None,[],[
 'Create a release reference. Record requester, club/dancer, asset or page URL, exact version/file, proposed change and intended destinations.',
 'Record the checks performed: identity/rights, content rules, factual/commercial accuracy, visual quality and audience permissions. Link the private evidence where appropriate.',
 'Record reviewer, decision, time and correction reason. Approved, Changes required and Escalated are operating-log decisions, not extra app status buttons.',
 'Record the authorized publisher and actual release time. Verify each internal/external destination and record who checked it and the outcome.',
 'At handover, list pending, processing, rejected/replacement and escalated items, plus the next action and responsible reviewer. Reconcile the queue against the log.'
 ],'The next reviewer can identify exactly what was approved, what was published and what remains unresolved.',
 'If a record lacks a version or destination, request that information before release. Do not backfill a sign-off as though it occurred before an unreviewed publication.')

# Platform-only supporting tasks remain in the club-admin chapter, clearly scoped.
task('A11','club-admin','Coordinate platform administration','MyDancr platform admin > Home, Approvals, People, Clubs, Money, More',
 'These are platform-level duties for an authorized MyDancr admin, separate from the club owner/team workspace. Club staff should raise a request rather than seek platform credentials.',
 'subscriptions',['Find a venue'],[
 'Platform admin: sign in at /admin with your own authorized account. Home summarizes work needing attention and operational health; inspect a flagged item before acting.',
 'Use Approvals for profile/image/video review and People for dancer account investigation. Confirm the account and current content version before saving any decision.',
 'Use Clubs for venue records, setup/review packages, commercial offers, table QR codes and NFC inventory. Keep club-requested changes tied to the originating request.',
 'Use Money > Venue subscription roster and search the venue [1]. It shows page status and the subscription-only model. Prices, payment status, renewals and recurring revenue are unavailable until billing records are connected.',
 'Use More for available support, reports, rights cases, sales-agent and other administrative tools. Assign an owner and record the result of each action.'
 ],'The club’s request reaches the correct platform function and has a verified outcome.',
 'A club manager’s permissions do not imply platform access. Escalate unsupported account, publication or billing changes rather than sharing admin credentials.')

task('A12','club-admin','Run the recurring administration review','Owner review with managers and content approval manager',
 'Use a recurring operational review to keep setup, access, content and records aligned. Frequency is a club policy; assign explicit owners and due dates.',
 'club-navigation',['Tonight','Dancers and tables','Results','Manage venue'],[
 'Daily: check urgent guest/ride/VIP issues, pending media and failed uploads; confirm the current duty manager and backup reviewer.',
 'Weekly: review Active team, Pending invitations and Recent activity. Remove obsolete access and follow up on lost or damaged QR/NFC materials.',
 'Weekly: compare Results periods, unresolved support cases and completed deal requests. Identify data anomalies without changing records simply to improve a metric.',
 'Before each release: inspect page/offer facts, media approvals and external website/TV destinations with the content approval manager.',
 'During staff onboarding: provide the appropriate role guide and one-page sheet, demonstrate the relevant controls, and record completion of the competency checklist.'
 ],'Outstanding administrative work has a named owner and due date, and newly trained staff can perform their role without using someone else’s account.',
 'Escalate overdue access, privacy, publication or guest-service issues to the owner. Keep operating records restricted to people who need them.')

CHEATS = {
 'club-admin': {
  'start': 'Use your club owner login. Name the duty manager, content reviewer and backup. Review the current club and release status.',
  'shot':'club-navigation',
  'rows':[
   ('Invite staff','Manage venue > Team & activity > email > Manager/Staff > Invite team member. Check delivery and Pending invitations.'),
   ('Change access','Owner only: Active team > role selector or Remove; revoke unused invitations and inspect Recent activity.'),
   ('Publish club','Review facts/terms > Preview customer experience > reviewer sign-off > Approve & make live > verify public page.'),
   ('Manage offers','Current Club Deals > Request a new deal / Request deal removal. MyDancr reviews and publishes; keep the reference.'),
   ('QR and NFC','MyDancr admin creates table QR signs. Club verifies placement. Dancer stickers: inventory > Test/Support when appropriate.'),
   ('External sites','Website grid > Preview > sign-off > Copy embed code > authorized website editor > check live destination.'),
   ('Review business','Results > consistent period/time zone. Keep passes, admissions, requests and subscriptions distinct.'),
  ],
  'stop':'Last active deal removal hides the club/schedules. Club removal ends affiliations/check-ins and stops stickers; returning needs a new agreement.',
  'check':'Can sign in, invite the correct role, find publication/deal status, identify the reviewer and explain QR versus NFC.',
 },
 'manager': {
  'start':'Sign in personally, confirm the club, refresh and read the previous handover. Assign each open queue to an employee.',
  'shot':'club-navigation',
  'rows':[
   ('Roster','Dancers & tables > search > All affiliated/Working now > Internal/External. Confirm availability directly.'),
   ('Table request','Details menu > Mark seen > check with dancer > Mark arrived / Didn’t arrive at table > Complete. Dismiss if cancelled.'),
   ('Guest list','Tonight > Guest list > Visit date > name/phone/email > Search. Dashboard shows records; door admission is separate.'),
   ('VIP','Invite guest > email > Send invitation. Requests > check date/time and dancers > Add message > Confirm request / Decline.'),
   ('Rides','Ride requests > Call guest > actual dispatch coordination > Contacted > Arranged > Completed or Cancelled.'),
   ('Contacts','Check Shared for and Email/Text update badges. Visit details are not a general marketing subscription.'),
   ('Handover','Record unresolved reference, last action, next action, owner and time. Check media/support issues and sign out on shared devices.'),
  ],
  'stop':'Seen is not arrived. Requested is not confirmed. A stale list is not proof of current status. Refresh before retrying a conflicting action.',
  'check':'Can find a dancer, explain table states, find a guest, process a VIP decision and write an actionable handover.',
 },
 'dancer': {
  'start':'Create your own dancer account. Save stage name/city, a main photo and at least three profile photos; accept the agreement and verify age.',
  'shot':'working-now',
  'rows':[
   ('Activate','Finish setup > tap club dressing-room sticker > choose visibility > wait for required media approval > Check activation status.'),
   ('Working Now','Eligible NFC tap: 6 hours working, then 6-hour cooldown across clubs. Retapping does not extend the window.'),
   ('Choose audience','Internal only = club roster; External only = public profile; Both = both. Full approved profile requirements still apply.'),
   ('Leave early','Overview > End Working Now > Yes, end now. Check inactive status; cooldown still applies.'),
   ('Media','Profile > Add photos/videos. Photos: 25 MB each, up to 50. Videos: 30 sec/25 MB output, up to 50. Read rules and status.'),
   ('Hide or share','Profile > Visibility & sharing > Go incognito / Make profile public. Wait for Saved. Share profile copies the public link.'),
   ('Get help','Rejected media: read correction note and replace. Pending: club reviewer. Shift issue: manager. Account/upload failure: Support.'),
  ],
  'stop':'Pending uploads count toward setup, not publication. Avatar is generated from the main photo and does not count as another gallery photo.',
  'check':'Can finish setup, explain pending approval, choose a tap audience, end a shift and find the reviewer/support contact.',
 },
 'content-approval': {
  'start':'Use assigned club owner/manager access. Confirm club, item identity, current version, rights and every intended destination.',
  'shot':'media-approval',
  'rows':[
   ('Open queue','Dancers & tables > Media approvals > Refresh. New dancers enter after their eligible NFC tap; use Previous/Next as needed.'),
   ('Inspect','Full photo; entire video with audio. Read AI findings. Check only adult account holder, coverage, prohibited content and rights.'),
   ('Decide','Approve only the inspected revision. Reject requires Review note: explain the issue and correction. Wait for save confirmation.'),
   ('Changed item','On stale/conflict error, refresh and inspect the current version. A replacement always needs fresh review.'),
   ('Other content','Hold text, logos, offers and website changes as drafts until recorded sign-off; the app has no universal technical gate.'),
   ('Verify release','Check internal profile, public profile/club, actual external embed and TV as applicable. Approval and visibility are separate.'),
   ('Incident','Stop further release; record URL/version/time; use authorized hide/remove or escalate to MyDancr; verify every affected destination.'),
  ],
  'stop':'No preview or processing still active: do not approve. Missing sign-off: do not publish. AI findings assist the human decision.',
  'check':'Can find a pending item, explain approval scope, write a useful rejection, record release sign-off and verify all destinations.',
 },
}
