"""Validate document completeness, navigation, page counts and layout bounds."""
from pathlib import Path
import json
import re
from pypdf import PdfReader
import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/mydancr-operations'
QA = ROOT / 'tmp/pdfs/operations-manual'
EXPECTED = {
    'MyDancr_Operations_Manual.pdf': 30,
    'MyDancr_Complete_Operations_Packet.pdf': 35,
    'MyDancr_Club_Admin_Onboarding_Guide.pdf': 5,
    'MyDancr_Manager_Talent_Onboarding_Guide.pdf': 6,
    'MyDancr_Dancer_Onboarding_Guide.pdf': 6,
    'MyDancr_Content_Approval_Onboarding_Guide.pdf': 4,
    **{f'MyDancr_{role}_Cheat_Sheet.pdf': 1 for role in ['Club_Admin', 'Manager_Talent', 'Dancer', 'Content_Approval']},
}

report = []
for name, count in EXPECTED.items():
    path = OUT / name
    reader = PdfReader(path)
    assert len(reader.pages) == count, (name, 'page count')
    assert path.stat().st_size < 4_000_000, (name, 'download size')
    ids = {page.indirect_reference.idnum for page in reader.pages}
    texts = [page.extract_text() for page in reader.pages]
    assert all(len(text) > 150 for text in texts), (name, 'blank/incomplete page')
    assert all('\ufffd' not in text for text in texts), (name, 'bad character')
    for page in reader.pages:
        for ref in page.get('/Annots', []):
            dest = ref.get_object().get('/Dest')
            if dest:
                if isinstance(dest, str): dest = reader.named_destinations[dest].dest_array
                assert dest[0].idnum in ids, (name, 'broken internal link')
    if 'Complete' not in name:
        for number, text in enumerate(texts, 1):
            assert f'{number} / {count}' in text, (name, number, 'footer')
            assert '21 Oct 2026' in text, (name, number, 'edition')
    if name == 'MyDancr_Operations_Manual.pdf':
        assert len(reader.outline) == 30
        assert len(reader.pages[1]['/Annots']) == 28
        text = ' '.join(' '.join(texts).split())
        for label in ['Approve & make live', 'Admit guest & redeem pass', 'Media approvals',
                      'Review note', 'Previous / Next', 'Copy embed code', 'MyDancr TV',
                      'Website embed color', 'Table QR color', 'before saving', '30 seconds']:
            assert label in text, label
        dancer = ' '.join(texts[15:21])
        assert not re.search(r'\b(rank|ranking|weights|weighted)\b', dancer, re.I)
    if 'Dancer_' in name:
        assert not re.search(r'\b(rank|ranking|weights|weighted)\b', ' '.join(texts), re.I)
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, 1):
            for char in page.chars:
                assert -0.1 <= char['x0'] <= char['x1'] <= page.width + .1, (name, number, 'horizontal overflow')
                assert -0.1 <= char['top'] <= char['bottom'] <= page.height + .1, (name, number, 'vertical overflow')
    report.append(dict(file=name, pages=count, bytes=path.stat().st_size,
                       words=len(' '.join(texts).split())))

for name in ['manual-layout-audit.json', 'layout_audit.json']:
    audit = json.loads((QA/name).read_text())
    assert all(row['bottom'] >= 54 for row in audit), (name, 'content enters footer')

result = dict(passed=True, documents=report, manual_links=28, one_page_cheat_sheets=4)
(QA/'validation.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
