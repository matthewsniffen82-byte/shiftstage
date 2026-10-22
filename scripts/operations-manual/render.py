"""Render all outputs for visual review; verify merged pages preserve the originals."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import shutil
import subprocess
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/mydancr-operations'
QA = ROOT / 'tmp/pdfs/operations-manual/rendered'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdftoppm', default=shutil.which('pdftoppm'))
    args = parser.parse_args()
    if not args.pdftoppm: parser.error('Pass the installed pdftoppm path.')
    QA.mkdir(parents=True, exist_ok=True)
    def render(path):
        subprocess.run([args.pdftoppm, '-png', '-r', '110', str(path), str(QA/path.stem)],
                       check=True, capture_output=True)
        return path.stem
    with ThreadPoolExecutor(max_workers=4) as pool:
        names = list(pool.map(render, sorted(OUT.glob('*.pdf'))))
    for name in names:
        pages = sorted(QA.glob(name+'-*.png'))
        for start in range(0,len(pages),4):
            sheet=Image.new('RGB',(1224,1624),'#ddd'); draw=ImageDraw.Draw(sheet)
            for j,path in enumerate(pages[start:start+4]):
                with Image.open(path) as im:
                    im.thumbnail((600,777))
                    x=(j%2)*612+6; y=(j//2)*812+6
                    sheet.paste(im,(x,y))
                    draw.text((x+8,y+780),path.stem,fill='black')
            sheet.save(QA/f'{name}-contact-{start//4:02}.jpg',quality=92)
    packet=sorted(QA.glob('MyDancr_Complete_Operations_Packet-*.png'))
    originals=sorted(QA.glob('MyDancr_Operations_Manual-*.png'))
    for role in ['Club_Admin','Manager_Talent','Dancer','Content_Approval']:
        originals += sorted(QA.glob(f'MyDancr_{role}_Cheat_Sheet-*.png'))
    assert len(packet)==35 and len(originals)==34
    for merged,original in zip(packet[1:],originals):
        with Image.open(merged) as a, Image.open(original) as b:
            assert a.size==b.size and ImageChops.difference(a,b).getbbox() is None, (merged,original)
    print(f'Rendered {len(names)} PDFs; all 34 merged content pages match their originals pixel for pixel.')

if __name__ == '__main__': main()
