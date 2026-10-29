"""Build the concise club manager guide with vector UI illustrations.

No browser, account data, screenshots, or application requests are used.
Run with the bundled workspace Python; see the adjacent README.
"""
from pathlib import Path
from html import escape
import json

from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "output/pdf/mydancr-operations/MyDancr_Club_Manager_Quick_Guide.pdf"
QA = ROOT / "tmp/pdfs/club-manager-guide"
W, H, M = 612, 792, 42
BW = W - M * 2
INK, MUTED = "#18151f", "#5b5765"
PURPLE, DARK, PANEL, BUTTON = "#7524ff", "#101014", "#1a1921", "#34343e"
WHITE, GREEN, AMBER = "#ffffff", "#76dfa7", "#ffcd67"
FONT_PATH = Path("C:/Windows/Fonts")
for name, file in [("Guide", "segoeui.ttf"), ("GuideBold", "segoeuib.ttf")]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_PATH / file)))

PAGES = [
    {
        "title": "Club manager quick guide", "path": "Start at mydancr.com/dashboard/venue", "figure": "navigation",
        "intro": "Use this guide to run a shift, review dancers, and manage your club in MyDancr. Start with Tonight, then open the tab for the job you need to do.",
        "steps": [
            ("Sign in with your own account", "Open your club team invitation and finish the steps shown. Check the club name before working. If your access is missing, ask the club owner to check your invitation and role."),
            ("Use the four main tabs", "Tonight handles guests, rides and VIP requests. Dancers & tables holds the roster, table requests and media review. Results shows activity. Club holds your page, offers, team and account settings."),
            ("Start with what needs attention", "Open Tonight and review any Needs attention items. Its guest, ride and VIP badges show outstanding work, not all-time totals. Refresh if a list looks out of date.")],
        "note": "How to use the pictures: these are simplified illustrations with sample information. Match the button words in the app. Available tools depend on your role and club setup.",
    },
    {
        "title": "Find a guest and check their pass", "path": "Tonight  >  Guest list", "figure": "guests",
        "intro": "The guest list tells you who registered and whether admission has been recorded. Being on this list does not mean the guest has entered the club.",
        "steps": [
            ("Choose the visit date", "Use Tonight, Choose a date or All active passes. Check the club time zone displayed beside the list."),
            ("Find and open the guest", "Search by name, phone or email, then select Search. Tap the guest row to see their contact details, arrival method and pass expiry."),
            ("Read the admission status", "Awaiting admission means the pass has not been used. Admitted means admission was recorded. Expired means the pass is no longer current. This panel has no admission button; follow your club's approved door procedure.")],
        "note": "Guest journey: Free Entry opens the arrival options directly. The guest chooses how to arrive and follows the form to obtain their pass. Each guest needs their own admission pass. Venue age, dress code, capacity and house rules still apply.",
    },
    {
        "title": "Handle rides and VIP requests", "path": "Tonight  >  Ride requests or VIP requests", "figure": "rides-vip",
        "intro": "Work these queues separately. Arranging transportation and confirming a VIP visit do not record a guest's admission.",
        "steps": [
            ("For a ride, contact the guest first", "Open Ride requests. Check the pickup location and passenger count, then use Call guest to arrange the details with your transport team."),
            ("Keep the ride status current", "Use Ride status: Received, Contacted, Arranged, Completed or Cancelled. Wait for saving to finish. The default Open view covers the last 48 hours; use All requests for older records."),
            ("For a VIP visit, review before confirming", "Open VIP requests, then Requests. Read the date, time, requested dancers and notes. Use Add message for a response, then Confirm request or Decline. Use All statuses to find earlier decisions.")],
        "note": "VIP access: use Invite guest to send a private invitation. Pending invitations have resend and revoke controls. Do not share a private invitation publicly. Ride tools appear when transportation is enabled or relevant requests are available.",
    },
    {
        "title": "Manage dancers and table requests", "path": "Dancers & tables  >  Roster or Table requests", "figure": "roster",
        "intro": "Use the roster to find dancers and check their current visibility. Use Table requests to coordinate a dancer's arrival at a table.",
        "steps": [
            ("Find the right dancer", "In Roster, choose All affiliated or Working now. Filter by Internal or External if needed. Both includes both destinations. Tap a profile to review it; open its three-dot menu for details."),
            ("Check in through the dancer tag", "Dancers use the club's dressing-room check-in tag and follow their own dashboard instructions. Check the displayed status and expiry. A dancer can be affiliated without being Working now, and internal and public lists can differ."),
            ("Follow the table request through", "Open Table requests. Select Mark seen to acknowledge it, coordinate with the dancer, then record Mark arrived or Didn't arrive at table. Complete the request when available and handled. Dismiss cancels it.")],
        "note": "Remove access ends the dancer's affiliation and current appearances at your club. It is not a routine end-of-shift action. Their account and media remain. Only use it when you intend to remove club access.",
    },
    {
        "title": "Review dancer profiles and media", "path": "Dancers & tables  >  Media approval", "figure": "approvals",
        "intro": "Review every submitted item, then submit the review. Saving choices alone does not finish the batch.",
        "steps": [
            ("Choose New dancers or Media updates", "New dancers includes profile and club-affiliation requests. Media updates covers submitted batches. Open the dancer or batch, view each photo, and play each video."),
            ("Save a decision for each item", "Choose Approve or Reject for each editable item. Add a short, useful correction note where needed. If you edit a note, choose Approve or Reject again to save it. Then select Submit review to send the batch to Site Admin."),
            ("Finish the new dancer's profile decision", "For a new dancer, return to their profile review after the media decisions. When enabled, choose Approve [name]'s profile to add the club affiliation. Follow any pending-review message; club affiliation alone does not complete onboarding.")],
        "note": "Required for onboarding: at least 3 approved profile photos and 1 approved video. The main photo counts toward the 3; the avatar is not an extra photo. Extra media is optional. Not approved items stay on the dancer's grid with a red border so they know what to replace. Each club's acceptance can differ.",
    },
    {
        "title": "Review your club page and deals", "path": "Club  >  Club information and Club Deals", "figure": "publication",
        "intro": "MyDancr prepares the club page for review. The manager checks the information and agreed deal before making the page live.",
        "steps": [
            ("Check the review package", "When the page is ready for review, open Club information. Check the logo, name, address, phone, website and hours. Open Club Deals and read the offer and Guest terms."),
            ("Preview, then approve or request changes", "Select Preview customer experience and follow Free Entry to inspect the arrival options. Preview does not create real passes or requests. Return to the dashboard. If correct, select Approve & make live; otherwise use Request changes and describe what to fix."),
            ("Use the correct change request", "After launch, use View club page or Request a change. For a deal, open Club Deals and choose Request a new deal or Request deal removal. Send the request and check its saved status; MyDancr reviews it before the deal changes.")],
        "note": "Removing the last active deal can hide the club and its dancer schedules from public discovery. Read the removal message carefully. For subscription or pilot arrangements, contact MyDancr.",
    },
    {
        "title": "Send an offer to club followers", "path": "Club  >  Contacts & marketing  >  Create club offer", "figure": "offers",
        "intro": "Use club offers for news, events and promotions in customer Alerts. This is separate from changing the public Club Deal or Free Entry terms.",
        "steps": [
            ("Write a short, useful offer", "Select Create club offer. Enter an Offer title and Message. Include what the guest gets, the date or hours, and any important restrictions. Check the eligible customer count."),
            ("Preview and publish", "Select Preview offer. Read the message and audience count. Use Edit message to correct it, then Publish to [number] customer Alerts. Wait for the published confirmation."),
            ("Review recent updates", "Published counts show offers added to Alerts, not email deliveries or views. Use Withdraw offer if it should no longer appear. Notifications already sent cannot be recalled.")],
        "note": "Who receives it: eligible customers who follow the club or subscribe to its updates. Muted club alerts are excluded. MyDancr combines offers into a daily email summary for customers who permit offer emails; push follows their choices. Limit: 3 offers per club per day. Contact details provided for a ride or guest list are not automatically marketing permission.",
    },
    {
        "title": "Set up your team and alerts", "path": "Club  >  Team & activity or Account", "figure": "team-alerts",
        "intro": "Give each team member their own access. Set notifications on the account and device used during the shift.",
        "steps": [
            ("Ask the owner to manage access", "Only the owner can invite or remove team members and change access levels. Managers can view team activity and manage club operations. Staff have fewer controls. Choose the role that fits the person's duties."),
            ("Complete the invitation", "The invited person opens their email link and completes the steps shown. If they cannot enter, check the invited email and ask the owner to review the invitation. Do not pass around a shared manager password."),
            ("Choose notifications for your account", "Open Account > Notification preferences. Turn Venue alerts on, choose the alert types, then choose Email and/or Push notifications. Allow browser notifications if prompted and enable push on the device you use. Wait for Preferences saved.")],
        "note": "Phone email alerts also depend on your email app settings. These preferences apply to your own account; they do not configure every employee's phone. Essential account and security messages remain on. Keep checking the dashboard during service.",
    },
    {
        "title": "Read results and get help", "path": "Results  |  Help", "figure": "results-help",
        "intro": "Use Results to review activity. Use Help for instructions and account-specific support when something does not look right.",
        "steps": [
            ("Compare the same period", "Open Results and choose the period available in the dashboard. Check the club time zone. Views, requests, guest-list signups and recorded admissions measure different things; do not treat them as interchangeable."),
            ("Try the simple checks first", "Refresh the panel. Check its date, status and search filters. Verify the club and account. An empty filtered list does not always mean no records exist. A missing control may depend on your role or club setup."),
            ("Send a clear support message", "Open Help. Use Ask assistant for quick instructions or Message the MyDancr Team for your account issue. Include the club name, screen, exact message, approximate time and what you expected. Check Messages for the reply.")],
        "note": "For an urgent issue affecting tonight's service, contact your duty manager directly. MyDancr support is not instant. You can also email support@mydancr.com. Keep passwords, private invitation links and identity documents out of support messages.",
    },
]

def color(value):
    return colors.HexColor(value)

def text(c, s, x, top, width, size=11.7, leading=16, bold=False, fill=INK):
    p = Paragraph(escape(s).replace("\n", "<br/>"), ParagraphStyle(
        "guide", fontName="GuideBold" if bold else "Guide", fontSize=size,
        leading=leading, textColor=color(fill)))
    _, height = p.wrap(width, H)
    p.drawOn(c, x, top-height)
    return top-height

def box(c, x, top, w, h, fill=PANEL, radius=10, stroke=None):
    c.setFillColor(color(fill))
    if stroke: c.setStrokeColor(color(stroke))
    c.roundRect(x, top-h, w, h, radius, fill=1, stroke=bool(stroke))

def button(c, label, x, top, w, selected=False, h=34):
    box(c, x, top, w, h, PURPLE if selected else BUTTON, 8)
    text(c, label, x+9, top-8, w-18, size=10.2, leading=12, bold=True, fill=WHITE)

def marker(c, n, x, y):
    c.setFillColor(color(AMBER)); c.circle(x, y, 10, fill=1, stroke=0)
    c.setFillColor(color(INK)); c.setFont("GuideBold", 10)
    c.drawCentredString(x, y-3.5, str(n))

def tabs(c, labels, x, top, w, selected=0):
    width=(w-6*(len(labels)-1))/len(labels)
    for i,label in enumerate(labels): button(c,label,x+i*(width+6),top,width,i==selected)

def screen(c, kind, top):
    """Vector illustrations intentionally simplify actual panels and use no real records."""
    x,w,h=M,BW,180
    box(c,x,top,w,h,DARK,14)
    ix,iy,iw=x+18,top-17,w-36
    if kind == "navigation":
        text(c,"Your club",ix,iy,iw,size=15,bold=True,fill=WHITE)
        tabs(c,["Tonight","Dancers & tables","Results","Club"],ix,iy-29,iw)
        text(c,"Tonight",ix,iy-80,iw,size=16,bold=True,fill=WHITE)
        text(c,"Needs attention",ix,iy-107,iw,fill=GREEN,bold=True)
        text(c,"Guest list  4     Ride requests  2     VIP requests  1",ix,iy-130,iw,fill=WHITE,size=11)
    elif kind == "guests":
        text(c,"Guest list",ix,iy,iw,size=16,bold=True,fill=WHITE)
        button(c,"Visit date: Tonight",ix,iy-29,175)
        button(c,"Find a guest",ix+185,iy-29,iw-185)
        tabs(c,["All","Awaiting admission","Admitted"],ix,iy-73,iw,1)
        box(c,ix,iy-117,iw,40)
        text(c,"Alex R.     Arriving on your own",ix+10,iy-127,290,fill=WHITE,size=11)
        text(c,"Awaiting admission",ix+310,iy-127,iw-320,fill=AMBER,size=10)
    elif kind == "rides-vip":
        gap=16; col=(iw-gap)/2
        text(c,"Ride requests",ix,iy,col,size=15,bold=True,fill=WHITE)
        text(c,"VIP access",ix+col+gap,iy,col,size=15,bold=True,fill=WHITE)
        button(c,"Call guest",ix,iy-31,col,True)
        button(c,"Ride status: Contacted",ix,iy-73,col)
        text(c,"Location and passengers",ix,iy-125,col,fill=WHITE,size=10.6)
        button(c,"Requests",ix+col+gap,iy-31,col,True)
        button(c,"Pending requests",ix+col+gap,iy-73,col)
        text(c,"Read visit details before deciding",ix+col+gap,iy-125,col,fill=WHITE,size=10.6)
    elif kind == "roster":
        tabs(c,["Roster","Table requests","Media approval"],ix,iy,iw)
        tabs(c,["All affiliated","Working now"],ix,iy-44,iw,1)
        text(c,"Internal    External    Both",ix,iy-93,iw,fill=GREEN,bold=True)
        text(c,"Table request",ix,iy-122,130,fill=WHITE,bold=True)
        button(c,"Mark seen",ix+155,iy-116,145,True)
        button(c,"Mark arrived",ix+310,iy-116,iw-310)
    elif kind == "approvals":
        tabs(c,["New dancers","Media updates"],ix,iy,iw)
        col=(iw-20)/3
        for i,(heading,action) in enumerate([("1  Review every item","Approve or Reject"),("2  Finish the batch","Submit review"),("3  Finish profile","Approve profile")]):
            xx=ix+i*(col+10)
            box(c,xx,iy-47,col,103)
            text(c,heading,xx+10,iy-59,col-20,size=10.5,bold=True,fill=WHITE)
            button(c,action,xx+6,iy-101,col-12,i==1,h=40)
    elif kind == "publication":
        text(c,"Review your club page & deal",ix,iy,iw,size=16,bold=True,fill=WHITE)
        button(c,"Club information",ix,iy-30,iw)
        button(c,"Club Deals",ix,iy-72,iw)
        button(c,"Preview customer experience",ix,iy-115,280)
        button(c,"Approve & make live",ix+290,iy-115,iw-290,True)
    elif kind == "offers":
        text(c,"Publish an offer",ix,iy,iw,size=16,bold=True,fill=WHITE)
        text(c,"Offer title",ix,iy-31,95,fill=WHITE,size=10)
        box(c,ix+100,iy-25,iw-100,29,BUTTON,6)
        text(c,"Tonight at the club",ix+110,iy-32,iw-120,fill=WHITE,size=10)
        text(c,"Message",ix,iy-71,95,fill=WHITE,size=10)
        box(c,ix+100,iy-65,iw-100,36,BUTTON,6)
        text(c,"Offer details, time and terms",ix+110,iy-74,iw-120,fill=WHITE,size=10)
        button(c,"Preview offer",ix,iy-117,185,True)
        text(c,"Then publish to customer Alerts",ix+205,iy-125,iw-205,fill=WHITE,size=11)
    elif kind == "team-alerts":
        col=(iw-18)/2
        text(c,"Team & activity",ix,iy,col,size=15,bold=True,fill=WHITE)
        text(c,"Notification preferences",ix+col+18,iy,col,size=14,bold=True,fill=WHITE)
        for i,(role,desc) in enumerate([("Owner","Invitations and roles"),("Manager","Club operations"),("Staff","Limited controls")]):
            text(c,role,ix,iy-34-i*36,col,bold=True,fill=WHITE,size=11)
            text(c,desc,ix,iy-49-i*36,col,fill="#bcb7c9",size=9.5,leading=12)
        for i,label in enumerate(["Venue alerts","Email","Push notifications"]):
            xx=ix+col+18; yy=iy-33-i*40
            text(c,label,xx,yy,col-52,fill=WHITE,size=10.5)
            box(c,xx+col-40,yy+1,39,21,PURPLE,10)
            text(c,"On",xx+col-32,yy-2,30,fill=WHITE,size=9)
    elif kind == "results-help":
        text(c,"Results",ix,iy,200,size=16,bold=True,fill=WHITE)
        tabs(c,["Tonight","7 days","30 days"],ix,iy-31,iw)
        text(c,"Use the same period when comparing activity",ix,iy-78,iw,size=11,fill=WHITE)
        button(c,"Ask assistant",ix,iy-112,180,True)
        button(c,"Message the MyDancr Team",ix+190,iy-112,iw-190)
    return top-h-8

def header(c,n,title,path):
    c.bookmarkPage(f"page-{n}")
    c.addOutlineEntry(title,f"page-{n}",level=0)
    text(c,"MYDANCR  /  CLUB MANAGER GUIDE",M,756,BW,size=9.5,leading=12,bold=True,fill=MUTED)
    text(c,title,M,731,BW,size=25,leading=29,bold=True)
    text(c,path,M,690,BW,size=10.4,leading=14,bold=True,fill="#5a21b8")

def footer(c,n):
    text(c,"29 October 2026  |  Club manager quick guide",M,31,BW-55,size=8.4,leading=10,fill=MUTED)
    c.setFont("GuideBold",9);c.setFillColor(color(INK));c.drawRightString(W-M,21,f"{n} / 10")

def build():
    OUT.parent.mkdir(parents=True,exist_ok=True);QA.mkdir(parents=True,exist_ok=True)
    c=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1,invariant=1)
    c.setTitle("MyDancr Club Manager Quick Guide")
    c.setAuthor("MyDancr")
    c.setSubject("Illustrated daily operations for club managers")
    bounds=[]
    for n,page in enumerate(PAGES,1):
        header(c,n,page["title"],page["path"])
        y=text(c,page["intro"],M,660,BW,size=11.8,leading=16)-14
        y=screen(c,page["figure"],y)
        y=text(c,"Illustration  |  Sample information",M,y,BW,size=8.3,leading=11,fill=MUTED)-15
        for step,(title,body) in enumerate(page["steps"],1):
            marker(c,step,M+10,y-9)
            y=text(c,title,M+28,y,BW-28,size=12.2,leading=16,bold=True)-4
            y=text(c,body,M+28,y,BW-28,size=11.3,leading=15)-13
        y=text(c,page["note"],M,y-1,BW,size=10.4,leading=14,fill=MUTED)
        assert y>47,(n,"Content overlaps footer",y)
        bounds.append({"page":n,"content_bottom":round(y,2)})
        footer(c,n);c.showPage()
    header(c,10,"Your shift checklist","Keep this page handy during service")
    y=660
    for heading,items in [
        ("Before the shift",["Sign in and confirm the club name.","Check Tonight and any Needs attention items.","Review rides, VIP visits and the guest list for the correct date.","Check the Working now roster and pending media reviews.","Make sure your account and device alerts are ready."]),
        ("During the shift",["Contact guests before marking rides Arranged.","Keep table requests and VIP decisions up to date.","Wait for saved confirmation after every action.","Keep guest admission separate from ride and request statuses."]),
        ("At handover",["Tell the next manager which rides and requests are still open.","Pass on pending approvals, guest issues and support references.","Check Results using the same period and club time zone.","Sign out if you are using a shared device."]),
    ]:
        y=text(c,heading,M,y,BW,size=16,leading=21,bold=True)-9
        for item in items:
            c.setStrokeColor(color("#918a9d"));c.setLineWidth(.8);c.rect(M+1,y-12,10,10)
            y=text(c,item,M+23,y,BW-23,size=11.4,leading=15)-9
        y-=12
    y=text(c,"Find the task",M,y,BW,size=16,leading=21,bold=True)-8
    links=[("Guest list",2),("Rides and VIP",3),("Roster and tables",4),("Media approval",5),
           ("Club page and deals",6),("Customer offers",7),("Team and alerts",8),("Results and help",9)]
    for i,(label,page) in enumerate(links):
        x=M+(i%2)*270; yy=y-(i//2)*23
        text(c,f"{label}  /  page {page}",x,yy,250,size=10.5,leading=14,fill="#5a21b8")
        c.linkRect("",f"page-{page}",(x,yy-17,x+250,yy+2),relative=0,thickness=0)
    assert y-90>47,("Checklist overlaps footer",y)
    footer(c,10);c.showPage();c.save()
    reader=PdfReader(OUT)
    assert len(reader.pages)==10
    all_text="\n".join(p.extract_text() for p in reader.pages)
    for required in ["Submit review","3 approved profile photos","1 approved video","Preferences saved","Contacts & marketing"]:
        assert required in all_text,required
    assert OUT.stat().st_size < 4_000_000
    (QA/"layout.json").write_text(json.dumps(bounds,indent=2))
    print(f"Built {OUT.name}: {len(reader.pages)} pages, {OUT.stat().st_size:,} bytes")

if __name__ == "__main__":
    build()
