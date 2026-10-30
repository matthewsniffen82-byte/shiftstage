"""Native PDF mockup drawing helpers. All pictured people and data are fictional."""
from pathlib import Path
from html import escape
from math import pi, cos, sin
import json
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader
from content import PAGES, R

for name, file in [('Regular','segoeui.ttf'),('Bold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name, 'C:/Windows/Fonts/'+file))
pdfmetrics.registerFontFamily('Regular', normal='Regular', bold='Bold')
W,H=612,792
INK=HexColor('#20202a'); MUTED=HexColor('#62616d'); PURPLE=HexColor('#6d28e8')
LILAC=HexColor('#f1ecfc'); LIGHT=HexColor('#f7f6fa'); LINE=HexColor('#e3dfea')
DARK=HexColor('#111116'); PANEL=HexColor('#292831'); UITEXT=HexColor('#d2cedc')
GREEN=HexColor('#84efb3'); GOLD=HexColor('#efba57'); RED=HexColor('#ffb1b8')
CHECKS=[]
C=None

def box(x,y,w,h,fill=LIGHT,r=8,stroke=None,lw=1):
    C.setFillColor(fill); C.setStrokeColor(stroke or fill); C.setLineWidth(lw)
    C.roundRect(x,H-y-h,w,h,r,stroke=bool(stroke),fill=1)

def line(x,y,x2,y2,col=LINE,lw=1):
    C.setStrokeColor(col); C.setLineWidth(lw); C.line(x,H-y,x2,H-y2)

def text(x,y,s,size=12,bold=False,col=INK,align='left'):
    font='Bold' if bold else 'Regular'
    for ch in s:
        assert ord(ch) in pdfmetrics.getFont(font).face.charToGlyph,(s,ch)
    C.setFont(font,size); C.setFillColor(col)
    draw={'left':C.drawString,'center':C.drawCentredString,'right':C.drawRightString}[align]
    draw(x,H-y-size*.82,s)

def p(x,y,w,s,size=12,leading=None,bold=False,col=INK,maxh=999,tag=''):
    lead=leading or size*1.35
    st=ParagraphStyle('body',fontName='Bold' if bold else 'Regular',fontSize=size,leading=lead,textColor=col)
    par=Paragraph(escape(s),st);_,h=par.wrap(w,900)
    assert h <= maxh+.1,(tag,s,h,maxh)
    par.drawOn(C,x,H-y-h)
    return h

def badge(n,x,y,r=11,fill=PURPLE,size=11):
    C.setFillColor(fill);C.circle(x,H-y,r,fill=1,stroke=0)
    text(x,y-size*.50,str(n),size,True,white,'center')

def arrow(n,y,tx):
    badge(n,42,y)
    line(54,y,tx-7,y,PURPLE,2)
    C.setFillColor(PURPLE)
    path=C.beginPath();path.moveTo(tx,H-y);path.lineTo(tx-7,H-y+4);path.lineTo(tx-7,H-y-4);path.close()
    C.drawPath(path,fill=1,stroke=0)

def centered_label(x,y,w,h,label,size=10.3,col=white):
    # Buttons keep a readable type size, wrapping long labels onto two lines.
    st=ParagraphStyle('button',fontName='Bold',fontSize=size,leading=size*1.15,textColor=col,alignment=1)
    par=Paragraph(escape(label),st);_,ph=par.wrap(w-14,200)
    assert ph<=h-8,(label,ph,h)
    par.drawOn(C,x+7,H-y-(h+ph)/2)

def button(x,y,w,label,h=32,tone='purple',size=10.3):
    fill={'purple':PURPLE,'gold':GOLD,'muted':PANEL,'danger':HexColor('#45252d'),'approve':HexColor('#1a4b37')}[tone]
    col=INK if tone=='gold' else RED if tone=='danger' else white
    box(x,y,w,h,fill,7)
    centered_label(x,y,w,h,label,size,col)

def portrait(x,y,w,h,video=False):
    # Native vector illustration: a neutral sample photo, never an actual person.
    box(x,y,w,h,HexColor('#3c354d'),9)
    C.saveState()
    clip=C.beginPath();clip.roundRect(x,H-y-h,w,h,9);C.clipPath(clip,stroke=0,fill=0)
    C.setFillColor(HexColor('#66517f'))
    C.circle(x+w*.78,H-y-h*.24,w*.46,stroke=0,fill=1)
    C.setFillColor(HexColor('#c4afd9'))
    C.ellipse(x+w*.25,H-y-h*.67,x+w*.75,H-y-h*.15,fill=1,stroke=0)
    C.ellipse(x+w*.07,H-y-h*1.4,x+w*.93,H-y-h*.59,fill=1,stroke=0)
    if video:
        C.setFillColor(DARK);C.circle(x+w*.5,H-y-h*.5,15,fill=1,stroke=0)
        C.setFillColor(white);q=C.beginPath();q.moveTo(x+w*.5-4,H-y-h*.5+6);q.lineTo(x+w*.5+6,H-y-h*.5);q.lineTo(x+w*.5-4,H-y-h*.5-6);q.close();C.drawPath(q,stroke=0,fill=1)
    C.restoreState()

def rowheight(row,w):
    defaults={'spacer':10,'heading':26,'button':32,'duo':35,'tabs':37,'filters':34,'field':51,'panel':57,'person':72,'media':91,'text':58,'small':29,'link':29,'metric':60,'refresh':36}
    if 'h' in row:return row['h']
    h=defaults[row['kind']]
    if row['kind'] in ('panel','text'):
        st=ParagraphStyle('measure',fontName='Regular',fontSize=10.0,leading=12.8)
        par=Paragraph(escape(row['detail']),st);_,dh=par.wrap(w-20,400)
        h=max(h,25+dh+8)
    if row['kind']=='field':
        st=ParagraphStyle('measure',fontName='Regular',fontSize=9.8,leading=12.0)
        par=Paragraph(escape(row['detail']),st);_,dh=par.wrap(w-20,400)
        h=max(h,23+dh+8)
    return h

def draw_row(row,x,y,w,h):
    k=row['kind'];label=row['label'];detail=row['detail']
    if k=='spacer':return
    if k=='heading':p(x,y+4,w,label,12.0,14.4,True,white,maxh=h-4)
    elif k=='button':button(x,y,w,label,h,row.get('tone','purple'))
    elif k=='duo':
        half=(w-6)/2
        approve=label=='Approve'
        button(x,y,half,label,h,'approve' if approve else 'muted',10)
        button(x+half+6,y,half,detail,h,'danger' if detail=='Reject' else 'muted',10)
    elif k in ('tabs','filters'):
        box(x,y,w,h,HexColor('#322b40'),7)
        centered_label(x,y,w,h,label,9.7,UITEXT)
    elif k=='field':
        p(x,y,w,label,9.5,11.5,True,UITEXT,maxh=12)
        box(x,y+16,w,h-16,PANEL,6)
        p(x+9,y+22,w-18,detail,9.8,12,col=white,maxh=h-25)
    elif k=='panel':
        box(x,y,w,h,PANEL,8)
        p(x+10,y+8,w-20,label,10.8,13.2,True,white,maxh=27)
        p(x+10,y+26,w-20,detail,10,12.8,col=UITEXT,maxh=h-31)
    elif k=='person':
        box(x,y,w,h,PANEL,8);portrait(x+9,y+9,43,h-18)
        p(x+62,y+13,w-70,label,11,13.5,True,white,maxh=28)
        p(x+62,y+36,w-70,detail,10,12.5,col=GREEN,maxh=h-40)
    elif k=='media':
        portrait(x,y,66,h,True)
        p(x+76,y+12,w-78,label,11,14,True,white,maxh=30)
        p(x+76,y+48,w-78,detail,10.2,13.5,col=UITEXT,maxh=40)
    elif k=='text':
        p(x,y+5,w,label,10.5,13.2,True,white,maxh=15)
        p(x,y+24,w,detail,10,13.0,col=UITEXT,maxh=h-24)
    elif k=='small':p(x,y+4,w,label,9.5,12,col=UITEXT,maxh=h-4)
    elif k=='link':p(x+4,y+6,w-8,label,10,12.5,True,UITEXT,maxh=h-6)
    elif k=='metric':
        box(x,y,w,h,HexColor('#193b2c'),8)
        p(x+10,y+10,w-20,label,14,17,True,GREEN,maxh=20)
        p(x+10,y+33,w-20,detail,10,13,col=UITEXT,maxh=h-36)
    elif k=='refresh':
        box(x,y,w,h,PANEL,7)
        text(x+10,y+12,label,10,False,UITEXT)
        cx=x+w-18;cy=y+h/2
        C.setStrokeColor(white);C.setLineWidth(1.6);C.arc(cx-6,H-cy-6,cx+6,H-cy+6,startAng=25,extent=300)
        line(cx+5,cy-6,cx+6,cy-1,white,1.6);line(cx+6,cy-1,cx+1,cy-2,white,1.6)

def phone(page,x=62,y=221,w=228,h=425,callouts=True):
    box(x+3,y+4,w,h,HexColor('#e7e3ed'),23)
    box(x,y,w,h,DARK,23,HexColor('#34313c'),1.1)
    box(x+w/2-25,y+9,50,4,HexColor('#56515e'),2)
    text(x+15,y+25,'CLUB DASHBOARD',8.5,True,UITEXT)
    text(x+15,y+43,page['tab'],12,True,white)
    line(x+15,y+66,x+w-15,y+66,HexColor('#37333f'))
    rx=x+16;rw=w-32;ry=y+77
    heights=[rowheight(r,rw) for r in page['rows']]
    total=sum(heights)+(len(heights)-1)*6
    space=h-98
    # Compact the spacing when a panel needs extra lines. Never reduce font size.
    gap=6 if total<=space else max(2,(space-sum(heights))/max(1,len(heights)-1))
    total=sum(heights)+(len(heights)-1)*gap
    assert total<=space+.1,(page['n'],total,space)
    marks=[]
    for row,rh in zip(page['rows'],heights):
        draw_row(row,rx,ry,rw,rh)
        if row['mark']:
            marks.append((row['mark'],ry+rh/2,rx+4))
        ry+=rh+gap
    if callouts:
        for n,cy,tx in marks:arrow(n,cy,tx)
    CHECKS.append({'topic':page['n'],'phone_end':round(ry,2),'phone_limit':y+h-15})
    assert ry<=y+h-14
    return marks
