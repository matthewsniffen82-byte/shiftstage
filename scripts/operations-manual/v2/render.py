"""Render final PDFs with Poppler and make legible two-page QA spreads."""
from pathlib import Path
import json, shutil, subprocess, sys
from PIL import Image, ImageOps, ImageDraw
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'output/pdf/mydancr-operations'
QA=ROOT/'tmp/pdfs/operations-manual-v2/rendered'
QA.mkdir(parents=True,exist_ok=True)
exe=shutil.which('pdftoppm')
if not exe:raise SystemExit('Poppler pdftoppm is required')
edition=json.loads((HERE/'edition.json').read_text())
for item in edition['documents']:
    if len(sys.argv)>1 and item['file'] not in sys.argv[1:]:continue
    dest=QA/item['file'].removesuffix('.pdf');dest.mkdir(exist_ok=True)
    subprocess.run([exe,'-r','105','-png',str(OUT/item['file']),str(dest/'page')],check=True,capture_output=True)
    pages=sorted(dest.glob('page-*.png'))
    assert len(pages)==item['pages'],item['file']
    for k in range(0,len(pages),2):
        ims=[Image.open(p).convert('RGB') for p in pages[k:k+2]]
        width=sum(im.width for im in ims)+16*(len(ims)-1)
        spread=Image.new('RGB',(width,max(im.height for im in ims)+24),'#dad5e1')
        x=0
        for n,im in enumerate(ims):
            spread.paste(im,(x,24));ImageDraw.Draw(spread).text((x+10,5),f'{item["file"]} / page {k+n+1}',fill='black');x+=im.width+16
        spread.save(dest/f'spread-{k//2+1:02}.jpg',quality=93)
    print(item['file'],len(pages),flush=True)
