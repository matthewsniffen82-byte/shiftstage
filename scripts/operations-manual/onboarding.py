from pathlib import Path
from copy import deepcopy
import json, re

ROOT = Path(__file__).resolve().parents[2]
import build as b
from reportlab.pdfgen import canvas
from reportlab.lib.colors import white
from pypdf import PdfReader
QA = b.QA
OUT = b.OUT
CURRENT = None
ARTIFACTS = []
GUIDES = b.DATA['guides']

def footer(c,n,total):
    c.setStrokeColor(b.RULE); c.setLineWidth(.6); c.line(42,39,570,39)
    c.setFillColor(b.G); c.setFont('Helvetica',8)
    c.drawString(42,25,'MyDancr | '+CURRENT['short']+' onboarding | 21 Oct 2026')
    c.drawRightString(570,25,f'{n} / {total}')
    b.para(c,'<link href="mailto:support@mydancr.com" color="#6736B6">Help: support@mydancr.com</link>  |  <link href="https://www.mydancr.com/guides" color="#6736B6">Download guides: www.mydancr.com/guides</link>',42,69,528,'small')

def notes(c,extras,x,y,w):
    for heading,body in extras:
        b.label(c,heading.upper(),x,y,8)
        if isinstance(body,dict):
            y=b.shot(c,body,x,y-12,w,220)-3
        else:
            y=b.para(c,b.txt(body),x,y-10,w)-20
    return y

def header(c,title,role,path,n,total):
    d = CURRENT['pages'][n-1]
    c.bookmarkPage(f'p{n}');c.addOutlineEntry(title,f'p{n}',0)
    b.label(c,'MYDANCR / '+CURRENT['name'].upper()+' / ONBOARDING',42,754,8.5)
    y=b.para(c,b.txt(title),42,730,528,'title')
    y=b.para(c,'<b>GO</b>  '+b.txt(path),42,y-11,528,'small')-13
    width=528/total
    for i,label in enumerate(CURRENT['nav'],1):
        x=42+(i-1)*width
        c.setFillColor(b.C if i==n else b.LIGHT)
        c.roundRect(x,y-23,width-4,23,4,fill=1,stroke=0)
        c.setFillColor(white if i==n else b.INK); c.setFont('Helvetica-Bold',8.2)
        c.drawCentredString(x+(width-4)/2,y-14,f'{i}  {label}')
        c.linkRect('',f'p{i}',(x,y-23,x+width-4,y),relative=0,thickness=0)
    y-=39
    if n==1:
        y=b.para(c,'<b>Your first read:</b> follow these '+str(total)+' pages in order, then keep your matching one-page cheat sheet handy. Numbered arrows match the actions on each page.',42,y,528,'small')-17
    c.setFillColor(b.G);c.setFont('Helvetica',8)
    c.drawString(42,49,'Full reference: Operations Manual, pp. '+d['master']+'.')
    if n==total:
        note=('Edition: 21 Oct 2026. Current club approval-queue capture; the queue was empty. Review-item controls use text references. Procedures follow the master manual source baseline 25813c6c0. Recheck after workflow changes.' if CURRENT['name']=='Content approval' else 'Edition: 21 Oct 2026. Earlier owner-supplied screenshots; new controls without captures use labeled text references. Procedures follow the master manual source baseline 25813c6c0. Recheck after workflow changes.')
        b.para(c,note,42,94,528,'small')
    footer(c,n,total)
    return y

def make_guide(guide):
    global CURRENT
    CURRENT=guide
    c=canvas.Canvas(str(OUT/guide['file']),pagesize=(612,792),pageCompression=1)
    c.setTitle('MyDancr - '+guide['name']+' onboarding guide')
    c.setAuthor('MyDancr Operations')
    c.setSubject('Role-specific first-day tasks, real app captures and verification steps')
    for n,d in enumerate(guide['pages'],1):
        b.body(c,d,n,len(guide['pages']))
        # Footer notes occupy the bottom strip on the final task page.
        assert b.AUDIT[-1]['bottom'] > (113 if n==len(guide['pages']) else 65), (guide['name'],n,b.AUDIT[-1])
    c.save(); ARTIFACTS.append(guide['file'])

def make_cheats(roles=None):
    global CURRENT
    for guide,source in zip(GUIDES,b.CHEATS):
        if roles is not None and guide['name'] not in roles: continue
        CURRENT=guide
        d=deepcopy(source)
        d['steps']=[(re.sub(r'^\d+\.\s*','',h),t) for h,t in d['steps']]
        d['pages']=guide['name']+' Onboarding Guide, pp. 1-'+str(len(guide['pages']))+'; '+source['pages']
        c=canvas.Canvas(str(OUT/d['file']),pagesize=(612,792),pageCompression=1)
        c.setTitle('MyDancr - '+d['title']+' cheat sheet - Role guide edition')
        c.setAuthor('MyDancr Operations')
        b.label(c,'MYDANCR / ONE-PAGE CHEAT SHEET',42,753,9)
        y=b.para(c,b.txt(d['title']),42,730,528,'title')
        y=b.para(c,b.txt(d['sub']),42,y-9,528,'intro')-17
        y=b.shot(c,d['shot'],42,y,528,76)
        y=b.steps(c,d['steps'],42,y,528)
        y=b.para(c,'<b>REMEMBER</b>  '+b.txt(d['rule']),42,y-2,528)-12
        y=b.para(c,'<b>IF BLOCKED</b>  '+b.txt(d['help']),42,y,528)-13
        y=b.para(c,'<b>Training:</b> '+b.txt(d['pages'])+'. | www.mydancr.com',42,y,528,'small')
        assert y>65, d['file']
        footer(c,1,1);c.showPage();c.save()
        b.AUDIT.append(dict(cheat=d['title'],bottom=round(y,1)))
        ARTIFACTS.append(d['file'])

def main():
    b.header=header;b.footer=footer;b.notes=notes
    for guide in GUIDES:
        make_guide(guide)
    make_cheats()
    (QA/'layout_audit.json').write_text(json.dumps(b.AUDIT,indent=2))
    (QA/'artifacts.json').write_text(json.dumps(ARTIFACTS,indent=2))
    for f in ARTIFACTS:
        r=PdfReader(OUT/f)
        print(f,len(r.pages),'pages',len(' '.join(p.extract_text() for p in r.pages).split()),'words')

if __name__=='__main__':main()
