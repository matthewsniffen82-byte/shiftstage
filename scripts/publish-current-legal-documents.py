"""Publish the approved public October 30 documents, preserving their exact text.

DMCA remains on its previous publication pending completed registered-agent
details. Internal procedures are deliberately absent from this allowlist.
"""
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
DOCUMENTS = [
    ('user-terms', 'User Terms', 'User Terms'),
    ('dancer-agreement', 'Dancer Agreement', 'Dancer Agreement'),
    ('club-agreement', 'Club Agreement', 'Club Agreement'),
    ('privacy', 'Privacy Policy', 'Privacy Policy'),
    ('california-privacy', 'California Privacy Notice', 'California Privacy Notice'),
    ('vip-table', 'VIP & Table Access Terms', 'VIP and Table Access Terms'),
    ('dancer-verification', 'Dancer Verification and Biometric Privacy Notice', 'Dancer Verification and Biometric Privacy Notice'),
    ('report-harmful-content', 'Report Harmful Content', 'Report Harmful Content'),
    ('federal-performer-records', 'Federal Performer Records Notice', 'Federal Performer Records Notice'),
]

def text(node):
    if node.tag in {W+'del', W+'moveFrom'}: return ''
    if node.tag == W+'t': return node.text or ''
    if node.tag in {W+'br', W+'tab'}: return '\n'
    return ''.join(text(child) for child in node)

def inline(value):
    value = escape(value)
    value = re.sub(r'([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})', r'<a href="mailto:\1">\1</a>', value)
    return value.replace('\n', '<br/>')

def convert(slug, title, source_title):
    filename = 'MyDancr_' + source_title.replace(' ', '_') + '_2026-10-30.docx'
    source = ROOT/'public/legal'/filename
    with ZipFile(source) as z:
        body = ET.fromstring(z.read('word/document.xml')).find(W+'body')
    output, contents = [], []
    for block in body:
        if block.tag == W+'p':
            value = text(block).strip()
            if not value: continue
            if value == 'MyDancr ' + source_title: continue
            style = block.find(W+'pPr/'+W+'pStyle')
            is_heading = (style is not None and style.get(W+'val','').lower().startswith('heading')) or bool(re.match(r'^\d+\s+[A-Z]', value))
            if is_heading and len(value) < 150:
                anchor = f'{slug}-section-{len(contents)+1}'
                contents.append({'id':anchor,'title':value})
                output.append(f'<h2 id="{anchor}">{inline(value)}</h2>')
            else: output.append(f'<p>{inline(value)}</p>')
        elif block.tag == W+'tbl':
            rows = []
            for index, row in enumerate(block.findall(W+'tr')):
                tag = 'th' if index == 0 else 'td'
                scope = ' scope="col"' if index == 0 else ''
                cells = [f'<{tag}{scope}>'+''.join(f'<p>{inline(text(p).strip())}</p>' for p in cell.findall(W+'p') if text(p).strip())+f'</{tag}>' for cell in row.findall(W+'tc')]
                rows.append('<tr>'+''.join(cells)+'</tr>')
            if rows:
                output.append('<div class="legal-table-scroll" role="region" aria-label="'+escape(title)+' table" tabindex="0" data-global-navigation-swipe="ignore"><table><thead>'+rows[0]+'</thead><tbody>'+''.join(rows[1:])+'</tbody></table></div>')
    document = {'title': title, 'version':'2026-10-30', 'sourceFile':filename, 'sourceSha256':sha256(source.read_bytes()).hexdigest(), 'downloadHref':'/legal/'+filename, 'contents':contents, 'html':'\n'.join(output)}
    destination = ROOT/'src/content/legal'/f'{slug}.json'
    destination.write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return document

if __name__ == '__main__':
    for item in DOCUMENTS:
        convert(*item)
        print('Converted',item[0])
