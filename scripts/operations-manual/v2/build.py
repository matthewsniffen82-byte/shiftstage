"""Build the new manual, four complete role guides and four one-page sheets."""
from pathlib import Path
import io, json, math, re, subprocess
from html import escape
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader, PdfWriter
from content import EDITION, ROLES, TASKS, CHEATS

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'output/pdf/mydancr-operations'
QA=ROOT/'tmp/pdfs/operations-manual-v2'
OUT.mkdir(parents=True,exist_ok=True); QA.mkdir(parents=True,exist_ok=True)
SHOTS={s['id']:s for s in json.loads((HERE/'screenshots/manifest.json').read_text())}
W,H=612,792
M=42; BW=W-2*M
INK=colors.HexColor('#171522'); MUTED=colors.HexColor('#5c5966')
PURPLE=colors.HexColor('#5932a3'); ORANGE=colors.HexColor('#ffbf47')
PALE=colors.HexColor('#f4f1fa'); LINE=colors.HexColor('#dcd7e6')
LAYOUT=[]; BUILT=[]

def clean(s):
    return s.replace('\u2011','-').replace('\u2013','-').replace('\u2014',' - ').replace('’',"'").replace('“','"').replace('”','"').replace('…','...').replace('→','>').replace('✓','')
def para(c,s,x,y,w=BW,size=10.2,leading=13.4,bold=False,color=INK):
    s=escape(clean(s)).replace('\n','<br/>')
    s=re.sub(r'\[(\d+)\]',r'<b>[\1]</b>',s)
    p=Paragraph(s,ParagraphStyle('p',fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,leading=leading,textColor=color,spaceAfter=0))
    _,height=p.wrap(w,700)
    if c: p.drawOn(c,x,y-height)
    return y-height
def footer(c,n,label='Operations manual'):
    c.setFillColor(MUTED); c.setFont('Helvetica',8)
    c.drawString(M,25,f'MyDancr | {label} | {EDITION}')
    c.drawRightString(W-M,25,str(n))
def header(c,kicker,title):
    c.setFillColor(PURPLE);c.setFont('Helvetica-Bold',9)
    c.drawString(M,H-42,clean(kicker).upper())
    return para(c,title,M,H-58,size=21,leading=24,bold=True)-10
def new_canvas(path):
    c=canvas.Canvas(str(path),pagesize=(W,H),pageCompression=1,invariant=1)
    c.setTitle('MyDancr '+path.stem.replace('MyDancr_','').replace('_',' '))
    c.setAuthor('MyDancr Operations');c.setSubject('Role-based operating procedures and onboarding')
    return c

def figure(c,shot_id,y,max_height=245,max_width=BW,controls=None,small=False):
    shot=SHOTS[shot_id]; im=Image.open(HERE/'screenshots'/f'{shot_id}.png').convert('RGB')
    # Cropping focuses the captured app's controls; arrows remain PDF vectors.
    if shot.get('pdfCrop'):
        box=shot['pdfCrop'];iw,ih=im.size
        im=im.crop((round(box['x']*iw),round(box['y']*ih),round((box['x']+box['width'])*iw),round((box['y']+box['height'])*ih)))
    scale=min(max_width/im.width,max_height/im.height)
    dw,dh=im.width*scale,im.height*scale
    x=M+(BW-dw)/2
    b=io.BytesIO();im.save(b,format='JPEG',quality=87,optimize=True)
    c.drawImage(ImageReader(b),x,y-dh,dw,dh)
    c.setStrokeColor(LINE);c.setLineWidth(.45);c.rect(x,y-dh,dw,dh)
    bubbles=[]
    for t in shot['targets']:
        if controls is not None and t['n']>len(controls): continue
        tx=x+t['x']*dw; ty=y-t['y']*dh
        # Place numbered bubbles above-left or above-right of the target.
        dx=34 if t['x']<.45 else -34
        dy=24 if t['y']>.16 else -24
        if shot_id=='results': dx,dy=100,0
        if dh<65: dy=17 if t['y']>.5 else -17
        sx=max(x+9,min(x+dw-9,tx+dx)); sy=max(y-dh+9,min(y-9,ty+dy))
        for offset in [0,22,-22,44,-44]:
            candidate=max(x+9,min(x+dw-9,sx+offset))
            if all(math.hypot(candidate-px,sy-py)>=19 for px,py in bubbles):
                sx=candidate;break
        if any(math.hypot(sx-px,sy-py)<19 for px,py in bubbles):
            raise RuntimeError(f'Overlapping arrow labels: {shot_id}')
        bubbles.append((sx,sy))
        # Distinct directions keep adjacent review controls legible.
        vx,vy=tx-sx,ty-sy;length=max(1,math.hypot(vx,vy)); ux,uy=vx/length,vy/length
        ex,ey=tx-ux*5,ty-uy*5
        c.setLineWidth(3.8);c.setStrokeColor(colors.HexColor('#1c1526'));c.line(sx,sy,ex,ey)
        c.setLineWidth(2);c.setStrokeColor(ORANGE);c.line(sx,sy,ex,ey)
        p=c.beginPath();p.moveTo(tx,ty);p.lineTo(tx-ux*8-uy*4,ty-uy*8+ux*4);p.lineTo(tx-ux*8+uy*4,ty-uy*8-ux*4);p.close()
        c.setFillColor(ORANGE);c.drawPath(p,fill=1,stroke=0)
        c.setFillColor(ORANGE);c.setStrokeColor(colors.HexColor('#1c1526'));c.setLineWidth(.9);c.circle(sx,sy,8,fill=1,stroke=1)
        c.setFillColor(INK);c.setFont('Helvetica-Bold',9);c.drawCentredString(sx,sy-3,str(t['n']))
    y-=dh+7
    caption='Current app component with training data. Numbered arrows identify controls.'
    if small: return y
    y=para(c,caption,M,y,size=8,leading=10,color=MUTED)-4
    if controls:
        legend='   '.join(f'[{i+1}] {v}' for i,v in enumerate(controls))
        y=para(c,legend,M,y,size=8.4,leading=11,bold=True)-7
    return y

def cover(c,role=None):
    y=header(c,'MyDancr team operations',ROLES[role][0] if role else 'MyDancr Operations Manual')
    y=para(c,'Complete role guide' if role else 'Club administration, talent management, dancers and content approval',M,y-4,size=16,leading=21)-20
    text=ROLES[role][2] if role else 'Use this manual to set up the club, operate a shift, onboard dancers and control content releases across internal and external destinations.'
    y=para(c,text,M,y,size=12,leading=17)-22
    y=para(c,'How to use this manual',M,y,size=14,leading=18,bold=True)-9
    for text in [
      'Find a task by its reference in the contents. Each procedure identifies where to go, which controls to use, the expected outcome and how to recover.',
      'Orange arrows and bracketed numbers identify the pictured controls. The numbered procedure is the order of work; a control reference such as [2] points into the screenshot.',
      'Screenshots are fresh captures of current app components rendered with fictional training data. They show actual app controls, not live guest accounts. Some figures focus on a panel rather than the whole screen.',
      'A guide describes the controls available to the role. Your club, account state and content status can change which controls appear. Wait for a saved result before assuming an action succeeded.'
    ]: y=para(c,text,M,y,size=11,leading=15)-12
    y=para(c,'Before any content goes live',M,y-3,size=14,leading=18,bold=True)-8
    y=para(c,'Pending dancer media has an app review workflow. For changes without that workflow, the editor must hold publication until the assigned content approval manager records sign-off. The app does not have one universal approval gate for all text, branding and site changes.',M,y,size=11,leading=15)-20
    y=para(c,'Edition and access',M,y,size=14,leading=18,bold=True)-8
    y=para(c,f'{EDITION}. Download current role guides and one-page sheets at www.mydancr.com/guides. Owners/managers can obtain the complete set; dancer accounts download dancer materials.',M,y,size=11,leading=15)-10
    y=para(c,'MyDancr support: support@mydancr.com\nCurrent-shift problems: your duty manager. Media decisions: your assigned reviewer. Team access: your club owner.',M,y,size=11,leading=15)
    footer(c,1,'Role guide' if role else 'Operations manual');c.showPage()

def contents(c,tasks,start_page,first_content_page):
    chunks=[tasks[i:i+22] for i in range(0,len(tasks),22)]
    page_map={t['code']:first_content_page+i for i,t in enumerate(tasks)}
    for ci,chunk in enumerate(chunks):
        y=header(c,'Find a procedure','Contents' if ci==0 else 'Contents continued')-10
        last_role=None
        for t in chunk:
            if t['role']!=last_role:
                y=para(c,ROLES[t['role']][0],M,y,size=12,leading=16,bold=True,color=PURPLE)-8
                last_role=t['role']
            ytop=y
            y=para(c,t['code']+'  '+t['title'],M,y,w=BW-35,size=10,leading=14)-8
            c.setFillColor(MUTED);c.setFont('Helvetica',10);c.drawRightString(W-M,ytop-11,str(page_map[t['code']]))
            c.linkRect('',t['code'],(M,y,W-M,ytop),relative=0,thickness=0)
        y=para(c,'Back matter: release log, shift handover and onboarding sign-off worksheets. Role guides include the relevant procedures in full.',M,min(y-15,110),size=9,leading=12,color=MUTED)
        footer(c,start_page+ci);c.showPage()

def foundations(c,page):
    y=header(c,'Shared operating rules','Roles access and daily habits')
    rows=[['Responsibility','Account/access','Owner of the work'],
      ['Club Admin team','Club owner; managers where allowed','Club setup, team, offers, website coordination'],
      ['Manager / talent team','Club manager; staff for limited floor duties','Roster, table/VIP/ride requests and handover'],
      ['Dancer','Personal dancer account','Own identity, media, visibility and check-in'],
      ['Content approval manager','Assigned club owner or manager','Media decisions and sign-off for every release'],
      ['MyDancr platform admin','Separately authorized /admin account','Platform records, QR provisioning and escalation']]
    data=[[Paragraph(escape(v),ParagraphStyle('t',fontName='Helvetica-Bold' if ri==0 else 'Helvetica',fontSize=9.4,leading=12)) for v in row] for ri,row in enumerate(rows)]
    table=Table(data,colWidths=[117,175,236]);table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('GRID',(0,0),(-1,-1),.5,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
    _,h=table.wrap(BW,600);table.drawOn(c,M,y-h);y-=h+20
    for title,text in [
      ('Sign in to the right workspace','Club owners/managers/staff use club sign in and /dashboard/venue. Dancers use dancer sign in and /dashboard/dancer. Platform admins use /admin. Do not reuse someone else\'s account. Use the sign-in password recovery control when necessary.'),
      ('Know the venue navigation','Tonight contains guest operations. Dancers & tables contains the roster, table requests and media approvals. Results contains metrics. Manage venue contains publication, deals, website/TV, team, notifications and account/support.'),
      ('Read the result','Refresh the relevant panel, note its timestamp, and wait for the success message after an action. If data is stale, unavailable or changed by someone else, reload before retrying. Protect guest details and private links.'),
      ('Understand the states','Affiliated does not mean Working Now. Uploaded does not mean Approved. Approved does not guarantee visibility on every channel. Acknowledged does not mean Arrived. A pass claim is not verified admission.'),
    ]:
        y=para(c,title,M,y,size=11,leading=14,bold=True)-5;y=para(c,text,M,y,size=10.1,leading=13.3)-13
    footer(c,page);c.showPage()

def task_page(c,t,page,label):
    c.bookmarkPage(t['code']);c.addOutlineEntry(t['code']+' '+t['title'],t['code'],level=0)
    y=header(c,ROLES[t['role']][0]+'  /  '+t['code'],t['title'])
    y=para(c,'GO TO  '+t['route'],M,y,size=8.7,leading=11.5,bold=True,color=PURPLE)-9
    y=para(c,t['purpose'],M,y,size=10.2,leading=13.4)-12
    # Fit the figure to the actual prose while keeping body type constant.
    after_height=0
    for i,step in enumerate(t['steps']): after_height += -para(None,step,0,0,w=BW-23,size=10.1,leading=13.2)+7
    for lead,key in [('Done when','done'),('If it does not work','recovery')]:
        after_height += -para(None,lead+'. '+t[key],0,0,size=9.6,leading=12.6)+10
    if t['shot'] and t['controls']:
        legend_height=-para(None,'   '.join(f'[{i+1}] {v}' for i,v in enumerate(t['controls'])),0,0,size=8.4,leading=11)
        max_height=min(270,y-52-after_height-40-legend_height)
        if max_height<65: raise RuntimeError(f'{t["code"]}: insufficient figure space {max_height}')
        y=figure(c,t['shot'],y,max_height=max_height,controls=t['controls'])
    y-=2
    for i,step in enumerate(t['steps']):
        c.setFillColor(PURPLE);c.setFont('Helvetica-Bold',10);c.drawString(M,y-10,str(i+1)+'.')
        y=para(c,step,M+23,y,w=BW-23,size=10.1,leading=13.2)-7
    y-=4
    for lead,key in [('Done when','done'),('If it does not work','recovery')]:
        y=para(c,lead+'. '+t[key],M,y,size=9.6,leading=12.6)-10
    LAYOUT.append({'document':label,'task':t['code'],'page':page,'bottom':round(y,2)})
    if y<43: raise RuntimeError(f'{t["code"]}: body overflows at {y}')
    footer(c,page,label);c.showPage()

def worksheet(c,page,role=None):
    y=header(c,'Keep with club operating records','Release log and shift handover' if role in (None,'content-approval') else 'Onboarding and handover record')
    y=para(c,'Complete a separate record for each release or open shift item. This worksheet is an operating record, not an additional screen in the app.',M,y,size=10.5,leading=14)-16
    if role in (None,'content-approval'):
        fields=[('Release reference and requester',''),('Club dancer page or asset',''),('Exact version and proposed change',''),('Intended internal and external destinations',''),('Checks and evidence reference',''),('Reviewer decision reason and decision time',''),('Publisher and actual release time',''),('Destination checks checker time and outcome','')]
    else:
        fields=[('Trainee role club and training date',''),('Trainer and account access verified',''),('Tasks demonstrated and remaining practice',''),('Duty manager content reviewer and backup',''),('Open item reference and last confirmed state',''),('Next action named owner and due time',''),('Incoming manager and handover time',''),('Completion sign off and follow up date','')]
    for title,_ in fields:
        y=para(c,title,M,y,size=9.5,leading=13,bold=True)-25
        c.setStrokeColor(LINE);c.setLineWidth(.5);c.line(M,y,W-M,y);y-=12
    y=para(c,'Handover essentials: reference | current status | last action | next action | owner | next check time. Keep personal data and evidence in authorized club records.',M,y-3,size=9.7,leading=13)-15
    y=para(c,'Training sign off: can locate the correct workspace, explain the key status differences, carry out the role\'s routine tasks, recognize a failed save and contact the correct escalation owner.',M,y,size=9.7,leading=13)
    footer(c,page,'Working record');c.showPage()

def build_manual(role=None):
    tasks=sorted([t for t in TASKS if role is None or t['role']==role],key=lambda t:(list(ROLES).index(t['role']),t['code']))
    file='MyDancr_Operations_Manual.pdf' if role is None else f'MyDancr_{ROLES[role][1]}_Onboarding_Guide.pdf'
    label='Operations manual' if role is None else ROLES[role][0]
    c=new_canvas(OUT/file);cover(c,role)
    nc=math.ceil(len(tasks)/22)
    first=3+nc
    contents(c,tasks,2,first)
    foundations(c,2+nc)
    p=3+nc
    for t in tasks:task_page(c,t,p,label);p+=1
    worksheet(c,p,role);c.save()
    BUILT.append({'file':file,'role':role or 'master','pages':p,'kind':'guide' if role else 'manual'})

def cheat(role):
    data=CHEATS[role];file=f'MyDancr_{ROLES[role][1]}_Cheat_Sheet.pdf';c=new_canvas(OUT/file)
    y=header(c,'MyDancr one page onboarding reference',ROLES[role][0])
    y=para(c,data['start'],M,y,size=10.1,leading=13.5)-10
    # A compact, real control strip anchors the sheet without crowding its tasks.
    shot='media-approval' if role=='content-approval' else 'club-navigation' if role in ('club-admin','manager') else 'visibility'
    y=figure(c,shot,y,max_height=90,max_width=BW,controls=None,small=True)-10
    for title,text in data['rows']:
        y0=y
        y=para(c,title,M,y,w=95,size=9.5,leading=12.5,bold=True,color=PURPLE)
        y=min(y,para(c,text,M+103,y0,w=BW-103,size=9.5,leading=12.5))-9
    y=para(c,'Remember. '+data['stop'],M,y-2,size=9.5,leading=12.5,bold=True)-10
    y=para(c,'Ready for the role. '+data['check'],M,y,size=9.3,leading=12.1)-9
    y=para(c,'Help: duty manager for shift issues; club reviewer for media; owner for access. MyDancr: support@mydancr.com | Current guides: www.mydancr.com/guides',M,y,size=8.7,leading=11.3)-11
    y=para(c,'Named manager / reviewer: ______________________   Trainer / date: ______________________',M,y,size=8.5,leading=11)
    if y<44:raise RuntimeError(f'{role} cheat overflows at {y}')
    LAYOUT.append({'document':file,'task':'cheat','page':1,'bottom':round(y,2)})
    footer(c,1,'One page cheat sheet');c.save();BUILT.append({'file':file,'role':role,'pages':1,'kind':'cheat-sheet'})

def main():
    build_manual()
    for role in ROLES:build_manual(role);cheat(role)
    packet=OUT/'MyDancr_Complete_Operations_Packet.pdf'
    writer=PdfWriter(clone_from=OUT/'MyDancr_Operations_Manual.pdf')
    for role in ROLES:writer.append(OUT/f'MyDancr_{ROLES[role][1]}_Cheat_Sheet.pdf',outline_item=ROLES[role][0]+' cheat sheet')
    writer.add_metadata({'/Title':'MyDancr Complete Operations Packet','/Author':'MyDancr Operations'})
    with packet.open('wb') as f:writer.write(f)
    BUILT.append({'file':packet.name,'role':'master','kind':'packet','pages':len(writer.pages)})
    for b in BUILT:
        b['bytes']=(OUT/b['file']).stat().st_size
        actual=len(PdfReader(OUT/b['file']).pages)
        if actual!=b['pages']:raise RuntimeError(f'Page count differs: {b["file"]} {actual} vs {b["pages"]}')
        if b['bytes']>=4_400_000:raise RuntimeError(f'Private download size exceeded: {b["file"]}')
    manifest={'edition':EDITION,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'taskCount':len(TASKS),'screenshotCount':len(SHOTS),'documents':BUILT}
    (HERE/'edition.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (QA/'layout.json').write_text(json.dumps(LAYOUT,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
