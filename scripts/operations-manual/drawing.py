from pathlib import Path
import math
from xml.sax.saxutils import escape
from PIL import Image
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/pdf/mydancr-operations'; OUT.mkdir(parents=True,exist_ok=True)
QA=ROOT/'tmp/pdfs/operations-manual'; QA.mkdir(parents=True,exist_ok=True)
ASSETS=Path(__file__).resolve().parent/'screenshots'
W,H=612,792
INK=HexColor('#17151E'); GRAY=HexColor('#55515D'); PURPLE=HexColor('#6736B6'); LIGHT=HexColor('#F1ECF8'); RULE=HexColor('#DDD8E3')
DATE='21 October 2026'
STYLES={
 'body':ParagraphStyle('body',fontName='Helvetica',fontSize=10.2,leading=14.1,textColor=INK),
 'small':ParagraphStyle('small',fontName='Helvetica',fontSize=8.5,leading=11.5,textColor=GRAY),
 'intro':ParagraphStyle('intro',fontName='Helvetica',fontSize=11,leading=15,textColor=GRAY),
 'title':ParagraphStyle('title',fontName='Helvetica-Bold',fontSize=25,leading=28.5,textColor=black),
 'cheat':ParagraphStyle('cheat',fontName='Helvetica',fontSize=10.1,leading=13.6,textColor=INK),
 'ref':ParagraphStyle('ref',fontName='Helvetica',fontSize=10,leading=13,textColor=INK),
}
AUDIT=[]
SOURCES=[]
def clean(t):
    return str(t).replace('\u2011','-').replace('\u2013','-').replace('\u2014',' - ').replace('\u2019',"'")
def para(c,t,x,y,w,style='body'):
    o=Paragraph(clean(t),STYLES[style]); _,hh=o.wrap(w,1000); o.drawOn(c,x,y-hh); return y-hh
def txt(t): return escape(clean(t))
def label(c,t,x,y,size=9,color=PURPLE):
    c.setFillColor(color);c.setFont('Helvetica-Bold',size);c.drawString(x,y,t)
def arrow(c,n,sx,sy,tx,ty):
    dx=tx-sx;dy=ty-sy;ln=max(1,math.hypot(dx,dy));ux,uy=dx/ln,dy/ln
    ax,ay=sx+ux*9,sy+uy*9
    c.setLineWidth(4.0);c.setStrokeColor(white);c.line(ax,ay,tx,ty)
    c.setLineWidth(1.8);c.setStrokeColor(PURPLE);c.line(ax,ay,tx,ty)
    p=c.beginPath();p.moveTo(tx,ty);p.lineTo(tx-ux*7-uy*3.7,ty-uy*7+ux*3.7);p.lineTo(tx-ux*7+uy*3.7,ty-uy*7-ux*3.7);p.close()
    c.setFillColor(PURPLE);c.drawPath(p,fill=1,stroke=0)
    c.setFillColor(white);c.setStrokeColor(PURPLE);c.setLineWidth(1.7);c.circle(sx,sy,8.8,fill=1,stroke=1)
    c.setFillColor(PURPLE);c.setFont('Helvetica-Bold',9);c.drawCentredString(sx,sy-3,str(n))
def screenshot(c,shot,x,top,maxw,maxh,caption=True):
    path=ASSETS/shot['asset']
    im=Image.open(path).convert('RGB'); l,t,r,b=0,0,1,1
    scale=min(maxw/im.width,maxh/im.height);iw,ih=im.width*scale,im.height*scale
    ix=x+(maxw-iw)/2;iy=top-ih
    # Preserve the screenshot's JPEG stream instead of expanding it into a large
    # uncompressed raster in every handout.
    c.drawImage(str(path),ix,iy,iw,ih)
    used=[]
    nav=(im.height/im.width)<.3
    for k,(n,fx,fy) in enumerate(shot['marks']):
        if not (l<=fx<=r and t<=fy<=b): continue
        tx=ix+(fx-l)/(r-l)*iw;ty=top-(fy-t)/(b-t)*ih
        sx=ix+10 if (fx-l)/(r-l)<.5 else ix+iw-10
        sy=min(top-11,max(iy+11,ty+23+(k%2)*5))
        if abs(sx-tx)<12: sx=ix+40 if sx<ix+iw/2 else ix+iw-40
        if nav:
            sx=max(ix+11,min(ix+iw-11,tx-26));sy=min(top-11,ty+30)
        while any(math.hypot(sx-a,sy-b)<22 for a,b in used):
            sy-=24
        used.append((sx,sy))
        arrow(c,n,sx,sy,tx,ty)
    if caption:
        iy=para(c,'App screenshot - owner supplied. Numbered arrows match the steps. Earlier layout; current instructions take precedence.',x,iy-9,maxw,'small')
    SOURCES.append((path.name,str(path.relative_to(ROOT))))
    return iy
