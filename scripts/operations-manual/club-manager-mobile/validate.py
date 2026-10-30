"""Validate the packet and prepare paired page renders for visual inspection."""
from pathlib import Path
import hashlib
import json
from PIL import Image
from pypdf import PdfReader
import pdfplumber
from mockups import EXAMPLES

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
QA = REPO / 'tmp/pdfs/club-manager-mobile'
PDF = REPO / 'output/pdf/mydancr-operations/MyDancr_Club_Manager_Manual.pdf'
reader = PdfReader(PDF)
assert len(reader.pages) == 35
assert PDF.stat().st_size < 4_000_000
texts = [p.extract_text() or '' for p in reader.pages]
full = '\n'.join(texts)
assert full.count('MOCKUP - SAMPLE DATA') == 8
for phrase in ['Approve', 'Reject', 'Submit review', 'Approve & make live', 'Preview website grid',
               'Mark seen', 'Mark arrived', 'Confirm request', 'Call guest', 'Publish to 12 customer Alerts']:
    assert phrase in full, phrase
for phrase in ['Add a note', 'adding notes', 'Review notes', 'Every screen is a real mobile capture']:
    assert phrase not in full, phrase
figures = json.loads((QA / 'figure-manifest.json').read_text())
captures = json.loads((ROOT / 'screenshots/manifest.json').read_text())
actual = [f for f in figures if f['kind'] == 'actual-mobile-screenshot']
assert len(actual) == len(captures) == 29
assert len({f['file'] for f in actual}) == 21
assert {(f['file'], tuple(f['crop'])) for f in actual} == {(f['file'], tuple(f['crop'])) for f in captures}
for capture in captures:
    assert hashlib.sha256((ROOT / 'screenshots' / capture['asset']).read_bytes()).hexdigest() == capture['sha256']
for figure in figures:
    if figure['kind'] == 'mockup':
        assert 'MOCKUP - SAMPLE DATA' in texts[figure['page'] - 1]
        assert all((REPO / source).exists() for source in figure['sources'])
assert {f['topic'] for f in figures if f['kind'] == 'mockup'} == {q['n'] for q in EXAMPLES.values()}

page_ids = {p.indirect_reference.idnum for p in reader.pages}
links = 0
for page in reader.pages:
    for reference in page.get('/Annots', []):
        annotation = reference.get_object()
        destination = annotation.get('/Dest')
        if destination:
            assert destination[0].idnum in page_ids
            links += 1
assert links == 30
with pdfplumber.open(PDF) as doc:
    for n, page in enumerate(doc.pages, 1):
        for char in page.chars:
            assert 0 <= char['x0'] < char['x1'] <= 613, (n, char)
            assert 0 <= char['top'] < char['bottom'] < 791, (n, char)

renders = sorted(QA.glob('page-*.png'))
assert len(renders) == 35, 'Render the final PDF with pdftoppm first.'
for start in range(0, len(renders), 2):
    images = [Image.open(path).convert('RGB') for path in renders[start:start + 2]]
    sheet = Image.new('RGB', (sum(im.width for im in images), max(im.height for im in images)), 'white')
    x = 0
    for image in images:
        sheet.paste(image, (x, 0))
        x += image.width
    sheet.save(QA / f'review-{start // 2 + 1:02}.jpg', quality=93)

report = dict(pages=35, screenshots=21, screenshot_crops=29, mockups=8, links=links, bytes=PDF.stat().st_size,
              geometry='pass', source_assets='pass', labels='pass', visual_review='required')
(QA / 'validation.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
