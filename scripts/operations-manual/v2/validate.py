"""Focused document checks, not an application or browser journey test."""
from pathlib import Path
import hashlib,json,re
from pypdf import PdfReader
import pdfplumber
from content import TASKS,ROLES
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
OUT=ROOT/'output/pdf/mydancr-operations';QA=ROOT/'tmp/pdfs/operations-manual-v2'
edition=json.loads((HERE/'edition.json').read_text());shots=json.loads((HERE/'screenshots/manifest.json').read_text())
by_shot={s['id']:s for s in shots};report=[]
def normalized(value):return re.sub(r'\s+',' ',value.replace('’',"'").replace('‘',"'")).strip()
for s in shots:
    assert (HERE/'screenshots'/f'{s["id"]}.png').is_file(),s['id']
    for t in s['targets']:
        assert 0<=t['x']<=1 and 0<=t['y']<=1,(s['id'],t)
    for f,digest in s['sources'].items():
        assert hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==digest,('Screenshot source changed',s['id'],f)
for t in TASKS:
    assert len(t['steps'])==5 and t['done'] and t['recovery'],t['code']
    if t['shot']:
        assert t['shot'] in by_shot,t['code']
        assert len(t['controls'])==len(by_shot[t['shot']]['targets']),(t['code'],'arrow legend mismatch')
    for n in re.findall(r'\[(\d+)\]',' '.join(t['steps'])):
        assert 1<=int(n)<=len(t['controls']),(t['code'],n)
catalog=(ROOT/'src/lib/dancr/operations-guides.ts').read_text(encoding='utf-8')
for item in edition['documents']:
    path=OUT/item['file'];reader=PdfReader(path)
    assert len(reader.pages)==item['pages'],item['file']
    assert path.stat().st_size<4_400_000,(item['file'],'download limit')
    assert bytes(path.read_bytes()[:4])==b'%PDF'
    ids={p.indirect_reference.idnum:i for i,p in enumerate(reader.pages)}
    texts=[p.extract_text() for p in reader.pages]
    assert all(len(t)>120 for t in texts),(item['file'],'empty page')
    assert not any('\ufffd' in t or '\u25a0' in t for t in texts),(item['file'],'missing glyph')
    links=0
    for pi,p in enumerate(reader.pages):
        for ref in p.get('/Annots',[]):
            annot=ref.get_object();dest=annot.get('/Dest')
            if dest:
                links+=1
                if isinstance(dest,str):dest=reader.named_destinations[dest].dest_array
                assert dest[0].idnum in ids,(item['file'],pi,'broken destination')
    if item['kind']=='cheat-sheet':assert len(reader.pages)==1
    if item['kind']=='guide':
        assert re.search(r'id: "'+item['role']+r'".*pages: '+str(item['pages'])+r'\b',catalog),(item['file'],'catalog page count')
    if item['kind'] in ('manual','guide','packet'):
        tasks=sorted([t for t in TASKS if item['role']=='master' or t['role']==item['role']],key=lambda t:(list(ROLES).index(t['role']),t['code']))
        for t in tasks:
            found=[i for i,txt in enumerate(texts) if re.search(r'/\s*'+re.escape(t['code'])+r'\b',txt) and 'GO TO' in txt]
            assert len(found)==1,(item['file'],t['code'],found)
            assert normalized(t['title']) in normalized(texts[found[0]]),(item['file'],t['code'],'title')
            toc=' '.join(texts[1:3] if item['role']=='master' else texts[1:2])
            assert t['code'] in toc,(item['file'],t['code'],'contents')
        assert links==len(tasks),(item['file'],'contents link count',links,len(tasks))
    # Check actual text geometry across every final page, including role-guide covers.
    with pdfplumber.open(path) as pdf:
        for pi,p in enumerate(pdf.pages):
            for ch in p.chars:
                assert 20<=ch['x0'] and ch['x1']<=592 and ch['top']>=18 and ch['bottom']<=779,(item['file'],pi+1,'text outside page',ch['text'])
    report.append({'file':item['file'],'pages':len(reader.pages),'bytes':path.stat().st_size,'workingContentsLinks':links})
packet=PdfReader(OUT/'MyDancr_Complete_Operations_Packet.pdf')
manual=PdfReader(OUT/'MyDancr_Operations_Manual.pdf')
assert len(packet.pages)==len(manual.pages)+4
assert [p.extract_text() for p in packet.pages[:len(manual.pages)]]==[p.extract_text() for p in manual.pages]
for n,role in enumerate(ROLES):
    sheet=PdfReader(OUT/f'MyDancr_{ROLES[role][1]}_Cheat_Sheet.pdf')
    assert packet.pages[len(manual.pages)+n].extract_text()==sheet.pages[0].extract_text()
for entry in json.loads((QA/'layout.json').read_text()):assert entry['bottom']>=43,entry
(QA/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'PASS: {len(report)} PDFs, {len(TASKS)} procedures, {len(shots)} fresh component captures; counts, arrows, source hashes, text bounds and PDF links verified.')
