from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.platypus import Table,TableStyle,Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import white,black
from pypdf import PdfReader
import drawing as old
DATA=json.loads((Path(__file__).parent/'content.json').read_text(encoding='utf-8'))
PAGES=DATA['pages']

ROOT,OUT,QA=old.ROOT,old.OUT,old.QA
C=old.PURPLE;G=old.GRAY;INK=old.INK;RULE=old.RULE;LIGHT=old.LIGHT
AUDIT=[]
old.STYLES['body']=ParagraphStyle('v2body',fontName='Helvetica',fontSize=10.5,leading=14.5,textColor=INK)
old.STYLES['title']=ParagraphStyle('v2title',fontName='Helvetica-Bold',fontSize=25,leading=28.5,textColor=black)
old.STYLES['small']=ParagraphStyle('v2small',fontName='Helvetica',fontSize=8,leading=10.5,textColor=G)
old.STYLES['table']=ParagraphStyle('v2table',fontName='Helvetica',fontSize=10,leading=13.4,textColor=INK)
old.STYLES['tablehead']=ParagraphStyle('v2th',fontName='Helvetica-Bold',fontSize=10,leading=13,textColor=white)
old.STYLES['lead']=ParagraphStyle('v2lead',fontName='Helvetica-Bold',fontSize=36,leading=39,textColor=black)
para,txt,label=old.para,old.txt,old.label

def footer(c,n,total):
    c.setStrokeColor(RULE);c.setLineWidth(.6);c.line(42,39,570,39)
    c.setFillColor(G);c.setFont('Helvetica',8)
    c.drawString(42,25,'MyDancr | Operations guide | 21 Oct 2026 | Revision 6')
    c.drawRightString(570,25,f'{n} / {total}')

def header(c,title,role,path,n,total):
    c.bookmarkPage(f'p{n}');c.addOutlineEntry(title,f'p{n}',0)
    label(c,'MYDANCR / '+role,42,754,8.5)
    y=para(c,txt(title),42,730,528,'title')
    y=para(c,'<b>GO</b>  '+txt(path),42,y-11,528,'small')-22
    footer(c,n,total)
    return y

def shot(c,ss,x,y,w=228,h=450):
    y=old.screenshot(c,ss,x,y,w,h,caption=False)
    caption=ss['captured']+'. Arrows match numbered steps.'
    return para(c,caption,x,y-8,w,'small')-17

def steps(c,d,x,y,w,start=1):
    for i,(name,body) in enumerate(d,start):
        y=para(c,f'<b>{i}. {txt(name)}.</b> {txt(body)}',x,y,w)-12
    return y

def outcome(c,d,x,y,w):
    y=para(c,'<b>DONE WHEN</b>  '+txt(d['done']),x,y-1,w)-12
    y=para(c,'<b>IF BLOCKED</b>  '+txt(d['issue']),x,y,w)
    return y

def notes(c,extras,x,y,w):
    for head,body in extras:
        if isinstance(body,dict):
            label(c,head.upper(),x,y,8);y=shot(c,body,x,y-12,w,150)-3
        else:
            label(c,head.upper(),x,y,8)
            y=para(c,txt(body),x,y-10,w,'body')-20
    return y

def table(c,rows,x,y,widths,headings=None,size='table'):
    data=[]
    if headings:data.append([Paragraph(txt(h),old.STYLES['tablehead']) for h in headings])
    data += [[Paragraph(v,old.STYLES[size]) for v in row] for row in rows]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    style=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.45,RULE)]
    if headings:style += [('BACKGROUND',(0,0),(-1,0),INK),('ROWBACKGROUNDS',(0,1),(-1,-1),[white,LIGHT])]
    else:style += [('ROWBACKGROUNDS',(0,0),(-1,-1),[LIGHT,white])]
    t.setStyle(TableStyle(style));_,hh=t.wrap(sum(widths),1000);t.drawOn(c,x,y-hh)
    return y-hh

def body(c,d,n,total):
    y=header(c,d['title'],d['role'],d['path'],n,total)
    if d['kind']=='access':
        rows=[['<b>Club owner</b>','Team membership and club participation, plus manager operations.'],
              ['<b>Manager</b>','Venue, roster, media approval, VIP, rides, contacts, finance and results.'],
              ['<b>Staff</b>','Limited venue operations; no media approval, VIP, rides or contacts.'],
              ['<b>Dancer</b>','Own profile, media, check-ins and activity analytics.'],
              ['<b>Content reviewer</b>','An assigned owner or manager. Reviews media using the club dashboard.']]
        y=table(c,rows,42,y,[110,418],['Role','Access'])-20
        left=steps(c,d['steps'],42,y,278);left=outcome(c,d,42,left,278)
        right=shot(c,d['shot'],344,y,226,320)
    elif d['kind']=='review':
        y=steps(c,d['steps'],42,y,528)-2
        rows=[['People','Uploader only, 18+. No other people or minors, including reflections/backgrounds.'],
              ['Coverage','Bikinis, opaque lingerie, thongs and cleavage may be allowed. Cover nipples, areolas, genitals and anus. Thong-exposed buttocks may be allowed. No sex acts or masturbation.'],
              ['Branding / contacts','No visible brands, logos or watermarks; no phone, email, social/payment handles or QR codes anywhere.'],
              ['Conduct','No sexual solicitation, drug use/sales, graphic violence, weapon threats, self-harm, hate, harassment, threats, coercion, nonconsensual content or deceptive impersonation.'],
              ['Rights / format','Own or have permission for all visuals and audio. Video: vertical/square MP4, WebM or MOV; 1-30 seconds; up to 25 MB. Do not bypass failed technical checks.']]
        y=table(c,rows,42,y,[112,416],['Check','Approval standard'])-16
        left=outcome(c,d,42,y,528);right=left
    elif d['kind']=='decision':
        y=para(c,'<b>1. Choose the outcome.</b> Escalate means leave the item private and contact the responsible team. It is not a dedicated queue button.',42,y,528)-14
        rows=[['<b>APPROVE</b>','All checks passed by the human reviewer; complete preview inspected; no unresolved issue.','Press <b>Approve</b> when enabled.'],
              ['<b>REJECT</b>','A clear rule violation or correction is identified.','Write a specific <b>Review note</b>, then <b>Reject</b>.'],
              ['<b>ESCALATE</b>','Missing preview, processing, uncertain age/identity/consent/rights, suspected abuse, or a changed upload.','Leave private. Contact the club lead/platform team. Refresh after the issue is resolved.']]
        y=table(c,rows,42,y,[90,242,196],['Decision','Use when','Action'])-18
        y=para(c,'<b>Write a correction the dancer can act on</b>',42,y,528)-8
        for text in ['"Another person appears in the mirror. Replace this with a photo showing only you."',
                     '"A visible logo appears on the clothing. Replace or edit the file so no logo remains."',
                     '"Your payment handle appears at 00:07. Remove it and submit a corrected video."']:
            y=para(c,txt(text),53,y,517,'table')-7
        y=para(c,'A rejection note needs at least 3 characters (maximum 4,000). Avoid vague notes such as "bad photo" or unsupported allegations.',42,y-1,528,'small')-16
        y=steps(c,d['steps'][1:],42,y,528,2)
        left=outcome(c,d,42,y,528);right=left
    elif d['kind']=='refresh':
        y=steps(c,d['steps'],42,y,528)-3
        rows=[
          ['Public dancer grid','30 seconds','Visible page only; also refreshes on return. Confirm filters before comparing counts.'],
          ['Public Clubs / club roster','Manual','Use Refresh. This view is not on the public dancer-grid automatic timer.'],
          ['Website embed','60 seconds','Visible page; also on visibility return. Refresh icon is available.'],
          ['Club dashboard / operations','45 / 30 seconds','Dashboard data refreshes about every 45 seconds; active operations data about every 30 seconds, while visible.'],
          ['Internal roster','20 minutes','Full roster interval. The authenticated staff view checks request updates about every 10 seconds. Guest table views refresh on return; use manual Refresh for a fresh roster.'],
          ['VIP dashboard','60 seconds','Overview, plan and requests refresh while visible, and on return. Do not assume every VIP tab has the same timer.'],
          ['Media approvals','Use Refresh','Refresh after an uncertain result. Successful decisions update the queue; review the exact current file/version.']]
        y=table(c,rows,42,y,[141,92,295],['Screen','Current interval','What the operator should know'])-19
        left=outcome(c,d,42,y,528);right=left
    elif d['kind']=='troubleshooting':
        rows=[
          ['Wrong dashboard / account warning','Confirm email and role. VIP uses /vip. Recover the original dancer account. Club membership problems go to the owner.'],
          ['Failed upload transfer','Use the retry control; check format/size and connection. Do not repeatedly resubmit a processing file.'],
          ['Processing / no preview','Wait, then Refresh. Reviewer leaves the item private; escalate a persistent failure.'],
          ['Pending / rejected media','Pending: confirm the first NFC connection and club reviewer. Rejected: read the reason and correct the file.'],
          ['Approved but not visible','Check enrollment, required verification, profile visibility and check-in channel. Then inspect the eligible destination.'],
          ['Stale queue / uncertain save','Refresh the relevant panel and inspect the existing record before repeating the action. Check club/date/filters.'],
          ['Missing alert','Check account mailbox, spam, optional preferences and device permission. Continue using the dashboard queue.'],
          ['Wrong QR / sticker destination','Stop using the affected sign/tag; record club, label, physical placement and destination for the administrator.']]
        y=table(c,rows,42,y,[149,379],['Problem','Next action'])-18
        y=para(c,'<b>Send a useful support report</b><br/>Role + club + account/record reference + local time/timezone + device/browser + expected result + exact result/error + safely cropped screenshot. Exclude passwords, ID documents and private invitation/programming links.',42,y,528)-15
        left=outcome(c,d,42,y,528);right=left
    else:
        # Two real task columns: actions on the left, visual/detail on the right.
        left=steps(c,d['steps'],42,y,278)
        left=outcome(c,d,42,left,278)
        right=y
        if d['shot']:
            maxh=420 if not d['extras'] else (320 if len(d['extras'])==1 else 250)
            right=shot(c,d['shot'],344,right,226,maxh)
        if d['kind']=='qr':
            right=table(c,[['201','210','10'],['201','211','11'],['1','20','20']],344,right,[65,65,96],['First','Last','Count'])-22
            right=notes(c,[('Sign checklist','Table number is correct. QR opens the right club/table. Footer says Powered by MyDancr and www.mydancr.com.')],344,right,226)
            right=notes(c,[d['extras'][-1]],344,right,226)
        else:right=notes(c,d['extras'],344,right,226)
    if min(left,right)<54:raise RuntimeError(f'Overflow {n} {d["title"]}: {left:.1f}, {right:.1f}')
    AUDIT.append(dict(page=n,title=d['title'],bottom=round(min(left,right),1)))
    c.showPage()

def cover(c,total):
    c.bookmarkPage('p1');c.addOutlineEntry('Operations manual - Revision 6','p1',0)
    label(c,'MYDANCR / OPERATIONS',42,750,11)
    y=para(c,'Operations manual',42,690,528,'lead')
    y=para(c,'A task guide for club admins, talent managers,<br/>dancers and content reviewers.',42,y-22,528,'intro')-34
    for role,rng,text in [('Club Admin team','05-08','Venue publication, team access, table signs and sticker checks.'),
                          ('Managers & talent','09-15','Shift control, roster, table requests, guest list, VIP, rides and results.'),
                          ('Dancers','16-21','Onboarding, media, check-ins, visibility, activity and account help.'),
                          ('Content approval','22-25','Review queue, full-file checklist, decisions and release coverage.')]:
        label(c,rng,42,y,14)
        y=para(c,f'<b>{role}</b><br/>{text}',106,y+5,464)-24
    y=para(c,'<b>Every task follows the same pattern</b><br/>GO: where to start. Numbered steps: what to do. DONE WHEN: how to verify it. IF BLOCKED: the next action.',42,y-3,528)-21
    y=para(c,'<b>Use the right handout.</b> Keep this complete manual with club administrators and managers. Give dancers pages 16-21 and the dancer one-page guide. Manager ranking details are not part of dancer training.',42,y,528)-18
    y=para(c,'<b>Additional operating tasks:</b> troubleshooting (p. 26), website grids and branding (p. 27), TV and profile media (p. 28), refresh guidance (p. 29) and training sign-off (p. 30).',42,y,528)-18
    y=para(c,'Revision 6 | 21 October 2026. Current written procedures checked against app source. Screenshots include a current club approval-queue capture and earlier owner-supplied app captures; controls not pictured use text references. See edition notes on p. 30.',42,y,528,'small')
    assert y>54
    footer(c,1,total);c.showPage()

def contents(c,total):
    y=header(c,'Find the task','EVERYONE','Select a title to jump to its page.',2,total)
    groups=[('Shared essentials',[(3,PAGES[0]['title']),(4,PAGES[1]['title'])]),
            ('Club Admin team',[(n,PAGES[n-3]['title']) for n in range(5,9)]),
            ('Managers & talent',[(n,PAGES[n-3]['title']) for n in range(9,16)]),
            ('Dancers',[(n,PAGES[n-3]['title']) for n in range(16,22)]),
            ('Content approval',[(n,PAGES[n-3]['title']) for n in range(22,26)]),
            ('More operating tasks',[(n,PAGES[n-3]['title']) for n in range(26,30)]+[(30,'Training and edition notes')])]
    for x,group in [(42,groups[:3]),(315,groups[3:])]:
        yy=y
        for heading,items in group:
            label(c,heading.upper(),x,yy,9);yy-=20
            for n,title in items:
                c.setFont('Helvetica-Bold',10);c.setFillColor(C);c.drawString(x,yy-10,f'{n:02}')
                bottom=para(c,txt(title),x+24,yy,226)
                c.linkRect('',f'p{n}',(x,bottom-3,x+250,yy+3),relative=0,thickness=0)
                yy=bottom-12
            yy-=12
    y=133
    y=para(c,'<b>Arrows point to controls.</b> Numbers match task steps. Screenshot names, counts, media and old approval badges are navigation examples, not evidence for a current approval decision.',42,y,528,'small')-10
    y=para(c,'<b>Three separate controls:</b> approval permits content publication; profile visibility controls whether it is shown; the check-in channel chooses internal, external or both. Changing one does not automatically change the others.',42,y,528,'small')
    assert y>54
    c.showPage()

def training(c,total):
    y=header(c,'Training and edition notes','TEAM LEADS','Use the matching one-page guide during onboarding.',total,total)
    y=para(c,'<b>Before independent use, have the trainee demonstrate:</b>',42,y,528)-15
    for line in ['Correct account, club and sign-in route; recovery without a duplicate account.',
                 'Their role\'s main task, followed by checking the saved outcome.',
                 'The difference between a notification, request, arrival and completed task.',
                 'Who handles failed transfers, pending media and account/identity problems.',
                 'A safe support report and sign-out from a shared device.']:
        c.setStrokeColor(G);c.rect(43,y-10,8,8,fill=0,stroke=1)
        y=para(c,txt(line),61,y,509)-12
    y=para(c,'Demonstrate read-only navigation or use approved training records. Do not publish real content, send an invitation or complete a real request merely for practice.',42,y,528,'small')-23
    y=para(c,'Trainee: __________________________  Role: ________________________<br/><br/>Club: _____________________________  Trainer: _____________________<br/><br/>Date: _____________________________  Follow-up: ___________________',42,y,528)-30
    y=para(c,'<b>Edition and maintenance</b>',42,y,528)-12
    y=para(c,'Revision 6, 21 October 2026. Written procedures were checked against the current workspace implementation, including club access, venue publication, QR/sticker management, live request queues, dancer onboarding and the human media-review flow. Application source baseline: 25813c6c0.',42,y,528)-14
    y=para(c,'The club Media approvals screen was captured on 20 October 2026 (p. 22). The queue was empty, so review-item controls such as Approve and Reject remain labeled text references. Other screenshots are earlier owner-supplied captures. Each image is labeled; arrows point to the numbered steps.',42,y,528)-14
    y=para(c,'After a release, recheck permissions, approval rules, button labels, upload limits and check-in behavior. Replace earlier captures with current ones when available. Production configuration, including required age verification, can vary; follow the current account status.',42,y,528)-14
    y=para(c,'This manual documents behavior and operating routines. It does not change permissions, approve content or replace the club\'s admission, privacy and incident procedures.',42,y,528,'small')
    assert y>54
    c.showPage()

CHEATS=DATA['cheats']

def main():
    total=len(PAGES)+3
    c=canvas.Canvas(str(OUT/'MyDancr_Operations_Manual.pdf'),pagesize=(612,792),pageCompression=1)
    c.setTitle('MyDancr Operations Manual - Revision 6');c.setAuthor('MyDancr Operations')
    c.setSubject('Role-based operations, annotated app screens and content-review decisions')
    cover(c,total);contents(c,total)
    for n,d in enumerate(PAGES,3):body(c,d,n,total)
    training(c,total);c.save()
    (QA/'manual-layout-audit.json').write_text(json.dumps(AUDIT,indent=2))
    assert len(PdfReader(OUT/'MyDancr_Operations_Manual.pdf').pages)==30
if __name__=='__main__':main()
