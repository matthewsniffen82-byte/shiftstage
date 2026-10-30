"""Build the mobile packet with real captures and clearly labeled vector examples."""
from pathlib import Path
from copy import deepcopy
from html import escape
from math import atan2, cos, sin
import json
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader
from content import PAGES
from mockups import EXAMPLES
import illustrations

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
OUT=REPO/'output/pdf/mydancr-operations'
QA=REPO/'tmp/pdfs/club-manager-mobile'
QA.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
PDF=OUT/'MyDancr_Club_Manager_Manual.pdf'
SRC=ROOT/'screenshots'
CAPTURES=json.loads((SRC/'manifest.json').read_text(encoding='utf-8'))
ASSETS={(i['file'],tuple(i['crop'])):SRC/i['asset'] for i in CAPTURES}
for name,file in [('Regular','segoeui.ttf'),('Bold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
W,H=612,792
INK=HexColor('#21202b'); MUTED=HexColor('#686572'); PURPLE=HexColor('#6d28e8')
LINE=HexColor('#ddd8e7'); LILAC=HexColor('#f1ecfb'); DARK=HexColor('#15121e')
C=canvas.Canvas(str(PDF),pagesize=(W,H),pageCompression=1)
C.setTitle('MyDancr Club Manager Manual - Mobile Screens and Examples')
illustrations.C=C
C.setAuthor('MyDancr')
CHECKS=[]; SOURCES=[]

def box(x,y,w,h,fill,r=9):
    C.setFillColor(fill); C.roundRect(x,H-y-h,w,h,r,fill=1,stroke=0)
def line(x,y,x2,y2,col=LINE,lw=1):
    C.setStrokeColor(col); C.setLineWidth(lw); C.line(x,H-y,x2,H-y2)
def text(x,y,s,size=12,bold=False,col=INK,align='left'):
    C.setFont('Bold' if bold else 'Regular',size); C.setFillColor(col)
    {'left':C.drawString,'center':C.drawCentredString,'right':C.drawRightString}[align](x,H-y-size*.82,s)
def p(x,y,w,s,size=12.3,leading=None,bold=False,col=INK,maxh=999):
    st=ParagraphStyle('p',fontName='Bold' if bold else 'Regular',fontSize=size,
                      leading=leading or size*1.36,textColor=col)
    q=Paragraph(escape(s),st);_,h=q.wrap(w,1000)
    assert h<=maxh+.1,(s,h,maxh)
    q.drawOn(C,x,H-y-h);return h
def badge(n,x,y,r=11):
    C.setFillColor(PURPLE);C.setStrokeColor(white);C.setLineWidth(1.2)
    C.circle(x,H-y,r,fill=1,stroke=1)
    text(x,y-5.5,str(n),11,True,white,'center')
def arrow(n,tx,ty,side='left'):
    bx=39 if side=='left' else 300
    badge(n,bx,ty)
    sx=bx+12 if side=='left' else bx-12
    # White under-stroke keeps the pointer visible against dark UI.
    line(sx,ty,tx,ty,white,3.3);line(sx,ty,tx,ty,PURPLE,1.8)
    a=atan2(0,tx-sx); ln=7
    for da in [-.55,.55]:
        line(tx,ty,tx-ln*cos(a+da),ty-ln*sin(a+da),PURPLE,1.8)
def shot(name,crop,x=58,y=221,w=226,marks=(),caption=None):
    src=ASSETS[(name,tuple(crop))]
    with Image.open(src) as raw:
        im=raw.copy()
    h=im.height*w/im.width
    C.drawImage(str(src),x,H-y-h,width=w,height=h)
    for n,px,py,*sd in marks:
        assert crop[0]<=px<=crop[2] and crop[1]<=py<=crop[3],(name,n,crop,px,py)
        arrow(n,x+(px-crop[0])*w/im.width,y+(py-crop[1])*w/im.width,sd[0] if sd else 'left')
    if caption:p(x,y+h+8,w,caption,9.2,12,col=MUTED)
    SOURCES.append(dict(page=C.getPageNumber(),file=name,crop=crop,marks=marks,kind='actual-mobile-screenshot'))
    return h
def footer(n):
    line(36,750,576,750)
    text(36,762,'MYDANCR • CLUB MANAGER GUIDE',8.5,True,MUTED)
    text(576,761,str(n),10,True,MUTED,'right')
def steps(items,y=226):
    for i,(title,body) in enumerate(items,1):
        badge(i,330,y+8,10)
        ht=p(349,y,222,title,13.5,17,True)
        hb=p(349,y+ht+6,222,body,12.1,16.5)
        y+=ht+6+hb+22
    return y

pages=deepcopy(PAGES)
by={q['n']:q for q in pages}
by['09']['extra']='The queue was empty at capture. Example 09A shows the profile decision after media review.'
by['09']['note']='A live profile needs 3 approved photos (including the main photo), 1 approved video and the other required checks. A rejected extra item does not block a profile that meets them.'
by['10']['extra']='The batch could not load at capture. Example 10A shows Approve, Reject and Submit review.'
by['10']['steps']=[('Open the dancer’s batch','Tap a dancer under Media updates. Inspect every photo and play every video before deciding.'),('Choose Approve or Reject','Make one decision for each item. Check it saved, then use Next to continue through the batch.'),('Tap Submit review','Submit after every item has a decision. Wait for confirmation. If the batch will not load, refresh or contact support before reviewing.')]
by['13A']['extra']='Rhino was already live at capture. Example 13B shows the first-publication controls.'
by['21']['note']='Website grid is available when the club is live. The screenshot shows the exact Preview website grid button to open the embedded site.'
by['01']['steps'][0]=('Sign in','Use your club email and password. Open Club dashboard from the account menu. The dashboard is shown here.')
by['15']['extra']='The blank composer is shown. Example 15A shows the completed preview and publishing controls.'
by['04']['extra']='The captured ride queue was empty. Example 04A shows the contact and status controls.'
by['04']['steps'][0]=('Find and open the request','Use Show rides to find it. Open the request and check the pickup location, passengers, requested time and guest notes.')
by['05']['extra']='There were no pending visits at capture. Example 05A shows Confirm request and Decline.'
by['08']['extra']='Only open the menu to inspect access. Removing access changes the dancer’s affiliation.'
by['11']['extra']='The captured table queue was empty. Example 11A shows the actions at each request stage.'
by['18']['extra']='Owner controls shown. Use an email not already registered as a customer or dancer.'
by['19']['extra']='Three actual screen crops: alert categories, delivery settings and the dashboard inbox.'

# Each crop is from an actual mobile screenshot. No UI is redrawn.
SPECS={
'01':('02-dashboard-clean.png',(0,0,810,1010),[(2,60,470),(4,745,470,'right')],'Your four main dashboard tabs.'),
'02':('02-dashboard-clean.png',(0,350,810,1830),[(1,42,820),(2,65,960),(3,755,625,'right')],'Tonight and the guest-list controls.'),
'03':('02-dashboard-clean.png',(25,1040,785,1840),[(1,70,1275),(2,70,1450),(3,70,1585)],'An empty guest list is shown.'),
'04':('04-rides.png',(25,1040,785,1880),[(1,70,1415)],'Use Show rides or Open pickup inbox.'),
'05':('05-vip-requests.png',(25,1040,785,1660),[(1,85,1235),(3,740,1375,'right')],'Requests, VIP guests and Invitations.'),
'06':('06-vip-invite.png',(25,1040,785,2150),[(1,735,1120,'right'),(2,735,1245,'right'),(3,385,1185)],'Blank invitation form; guest email records are outside this crop.'),
'07':('07-roster.png',(25,1000,785,2090),[(1,80,1165),(2,80,1400),(3,65,1800)],'Search, channel filters and dancer cards.'),
'08':('08-dancer-access.png',(20,700,790,1570),[(1,240,860),(2,80,1260)],'The three-dot menu exposes Remove access.'),
'09':('09-new-dancers.png',(20,350,790,1510),[(1,65,1190)],'Actual New dancers entry screen.'),
'10':('10-media-updates.png',(20,1010,790,2350),[(1,70,1980)],'Open the dancer card to review the batch.'),
'11':('11-table-queue.png',(20,350,790,1480),[(1,100,1100),(3,60,1380)],'Table requests and Manage alerts.'),
'12':('12-customer-preview.png',(0,0,810,1460),[(1,150,400),(2,150,1350)],'Real customer preview, opened from the club dashboard.'),
'13':('13-deals.png',(25,680,785,2310),[(1,70,860),(2,70,990),(3,90,2070)],'Club page controls and deal-change requests.'),
'13A':('13-club-sections.png',(25,350,785,1450),[(1,65,1125)],'Rhino’s current live Club page & deals section.'),
'14':('14-contacts.png',(35,1440,775,2700),[(1,100,2050),(2,735,2275,'right'),(3,100,2385)],'Separate email and text marketing filters.'),
'15':('15-offer-form.png',(45,2590,765,3960),[(1,110,3270),(2,115,3880)],'The actual offer form before text is entered.'),
'16':('16-results.png',(20,370,790,1690),[(1,50,630),(2,65,1040),(3,65,1480)],'Choose the time period, then expand a results section.'),
'17':('17-performance.png',(35,2600,775,4140),[(1,65,2870),(2,620,3570,'right'),(3,735,4060,'right')],'A real performance card with Score details.'),
'18':('18-team.png',(55,1950,755,3630),[(1,140,2170),(2,190,2350)],'Owner invitation controls and the two access levels.'),
'20':('20-21-tools.png',(45,2110,765,3120),[(1,100,2480),(2,225,2655),(3,500,2655,'right')],'One active and one disabled tag are shown.'),
'21':('20-21-tools.png',(45,3170,765,3970),[(2,110,3480),(3,95,3890)],'Preview website grid is above the copy buttons.'),
'22':('22-help.png',(25,230,785,1565),[(2,65,420),(3,80,1170)],'The real Help & Messages panel.'),
}

def example_page(q):
    C.bookmarkPage('example-'+q['n'])
    C.addOutlineEntry(q['n']+'  '+q['title']+' (mockup)','example-'+q['n'],0)
    text(36,31,'ILLUSTRATED EXAMPLE',9.5,True,PURPLE)
    text(36,57,q['n'],29,True,PURPLE)
    th=p(116,56,460,q['title'],25,30,True,maxh=62)
    p(36,max(106,58+th+11),540,q['intro'],13.1,18,maxh=40)
    box(36,160,540,39,LILAC)
    p(48,169,516,q['path'],10.8,14.3,True,maxh=29)
    text(62,217,'MOCKUP - SAMPLE DATA',10.2,True,PURPLE)
    illustrations.phone(q,x=62,y=240,w=228,h=430)
    end=steps(q['steps'],y=246)
    assert end<674,(q['n'],'example steps overflow',end)
    box(36,685,540,53,LILAC)
    p(48,695,516,q['note'],10.8,14.3,maxh=43)
    footer(C.getPageNumber())
    CHECKS.append(dict(topic=q['n'],page=C.getPageNumber(),steps_end=round(end,1),kind='mockup'))
    SOURCES.append(dict(page=C.getPageNumber(),kind='mockup',topic=q['n'],sources=q['sources']))
    C.showPage()

# Cover uses the actual mobile capture.

box(0,0,W,792,DARK,0)
text(38,40,'MYDANCR',15,True,white)
text(38,82,'Club manager',33,True,white)
text(38,122,'operations manual',33,True,white)
p(38,180,510,'Simple steps. Real mobile screens. Labeled mockups for missing states. Arrows show where to tap.',17,23,col=HexColor('#ded6f0'))
shot('02-dashboard-clean.png',(0,0,810,1800),x=53,y=269,w=178)
text(268,288,'Start with your task',20,True,white)
for i,s in enumerate(['Run tonight’s queues','Manage dancers and media','Review results','Manage the club and team','Find tools and support']):
    text(270,335+i*42,f'{i+1}.  {s}',13.5,False,white)
p(268,574,285,'22 topics, first-time page approval, the opened-profile preview and 8 illustrated examples.',12.5,18,col=HexColor('#ded6f0'))
text(38,735,'Screens: 29 October 2026  |  Updated packet: 30 October 2026',10,False,HexColor('#d0c4df'))
C.showPage()

# Contents with clickable PDF links.
text(36,35,'QUICK FIND',10,True,PURPLE)
text(36,62,'Choose the job you need',27,True)
p(36,107,540,'Tap a topic in this PDF. Follow the numbered steps; arrows identify controls visible in the screenshot.',12.8,18)
y=164
for idx,q in enumerate(pages):
    if q['n']=='13A':continue
    n=int(q['n']); col=0 if n<=11 else 1; row=(n-1)%11
    xx=36+col*282; yy=y+row*40
    text(xx,yy,q['n'],12,True,PURPLE)
    p(xx+29,yy,238,q['title'],11.5,14.5,maxh=32)
    C.linkRect('',f"topic-{q['n']}",(xx,H-yy-32,xx+265,H-yy+2),relative=0,thickness=0)
box(36,625,540,92,LILAC)
p(50,638,510,'How to use the pictures',12,16,True)
p(50,660,510,'Real mobile captures are retained. Pages marked MOCKUP use sample data to explain states that could not be captured. Their arrows point to the controls used in each step.',11.5,15.5,maxh=49)
footer(2);C.showPage()

text(36,35,'EXAMPLE SCREENS',10,True,PURPLE)
text(36,62,'See the missing action screens',25,True)
p(36,109,540,'These pages are labeled mockups with fictional data. They illustrate the current controls for states that were empty or unavailable during capture.',12.8,18,maxh=65)
for i,q in enumerate(EXAMPLES.values()):
    yy=192+i*51
    text(36,yy,q['n'],13,True,PURPLE)
    p(91,yy,470,q['title'],13,17,True)
    C.linkRect('', 'example-'+q['n'], (36,H-yy-34,576,H-yy+3),relative=0,thickness=0)
    line(36,yy+33,576,yy+33)
box(36,632,540,96,LILAC)
p(50,644,510,'How to follow an example',12.5,17,True)
p(50,669,510,'Match the numbered arrows to the steps. The mockup is a simplified layout, not a live screenshot. Real screenshots elsewhere in this packet keep their original content.',11.5,15.5,maxh=50)
footer(C.getPageNumber());C.showPage()

for q in pages:
    C.bookmarkPage(f"topic-{q['n']}")
    C.addOutlineEntry(q['n']+'  '+q['title'],f"topic-{q['n']}",0)
    text(36,31,q['group'],9.5,True,PURPLE)
    text(36,57,q['n'],29,True,PURPLE)
    title_x=116 if len(q['n'])>2 else 92
    titleh=p(title_x,56,576-title_x,q['title'],25.5,30.5,True,maxh=62)
    intro_y=max(106,58+titleh+11)
    p(36,intro_y,540,q['intro'],13.1,18,maxh=40)
    box(36,160,540,39,LILAC)
    p(48,169,516,q['path'],10.8,14.3,True,maxh=29)
    if q['n']=='18':
        yy=219
        yy+=shot('18-team.png',(55,1900,755,2495),y=yy,w=190,marks=[(1,100,2170)])+10
        yy+=shot('18-team.png',(55,2500,755,3290),y=yy,w=190)+10
        shot('18-team.png',(55,3585,755,3710),y=yy,w=190,caption='Actual form, access-level descriptions and Invite button.')
    elif q['n']=='19':
        # Separate real crops prevent a long list from becoming illegible.
        yy=219
        yy+=shot('19-account-notifications.png',(55,4500,755,4940),y=yy,w=180,marks=[(1,85,4810)])+8
        yy+=shot('19-account-notifications.png',(55,6700,755,7360),y=yy,w=180,marks=[(2,85,6960)])+8
        shot('19-account-notifications.png',(55,2400,755,2965),y=yy,w=180,marks=[(3,85,2830)])
    else:
        name,crop,marks,cap=SPECS[q['n']]
        sw=min(226,438*(crop[2]-crop[0])/(crop[3]-crop[1]))
        h=shot(name,crop,w=sw,marks=marks,caption=cap)
        assert h<=438.1,(q['n'],h)
    end=steps(q['steps'])
    if q.get('extra'):
        end+=p(323,end+3,250,q['extra'],10.1,13.4,col=MUTED,maxh=100)+3
    assert end<674,(q['n'],'steps overflow',end)
    # A compact bottom note, consistently placed.
    note_size=10.8;note_lead=14.3
    box(36,685,540,53,LILAC)
    p(48,695,516,q['note'],note_size,note_lead,maxh=43)
    footer(C.getPageNumber())
    CHECKS.append({'topic':q['n'],'page':C.getPageNumber(),'steps_end':round(end,1)})
    C.showPage()
    if q['n'] in EXAMPLES:
        example_page(EXAMPLES[q['n']])
    if q['n']=='12':
        text(36,31,'CUSTOMER PREVIEW',9.5,True,PURPLE)
        text(36,57,'12A',29,True,PURPLE)
        text(116,58,'The opened dancer profile',24,True)
        p(36,109,540,'The Request button is also available inside the dancer profile.',13.1,18)
        box(36,160,540,39,LILAC)
        p(48,169,516,'View internal > tap a dancer picture',10.8,14.3,True)
        shot('12-profile.png',(0,0,810,1770),x=61,y=214,w=213,marks=[(1,770,1450,'right')])
        steps([('Find Request','The club-branded Request button sits beside the dancer’s working status and club name.'),('Remember preview mode','The Customer preview message confirms that no real requests are sent from this dashboard preview.'),('Return to the grid','Use the back arrow at the top-left of the profile.')])
        box(36,703,540,34,LILAC)
        p(48,711,516,'This screenshot was taken from the actual club-dashboard customer preview.',10.8,14.3)
        footer(C.getPageNumber());C.showPage()

C.save()
reader=PdfReader(PDF)
full='\n'.join(p.extract_text() or '' for p in reader.pages)
(QA/'extracted-text.txt').write_text(full,encoding='utf-8')
(QA/'layout-check.json').write_text(json.dumps(CHECKS,indent=2),encoding='utf-8')
(QA/'figure-manifest.json').write_text(json.dumps(SOURCES,indent=2),encoding='utf-8')
assert len(reader.pages)==35,len(reader.pages)
assert PDF.stat().st_size<4_000_000,PDF.stat().st_size
assert full.count("MOCKUP - SAMPLE DATA")==8
assert 'SIMPLIFIED MOBILE VIEW' not in full
assert 'Illustration of' not in full
assert 'Approve or Reject' in full and 'Submit review' in full
assert 'Preview website grid' in full
print(json.dumps({'pdf':str(PDF),'pages':len(reader.pages),'bytes':PDF.stat().st_size,'screenshots':len(set(s['file'] for s in SOURCES if s['kind']=='actual-mobile-screenshot'))}))
