"""Focused publication checks; run with the bundled Python runtime."""
from hashlib import sha256
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("publisher", ROOT / "scripts/publish-current-legal-documents.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class VisibleHTML(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.text = []
        self.ids = []
        self.links = []
        self.feed(html)

    def handle_data(self, text):
        self.text.append(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a":
            self.links.append(attrs["href"])


def accepted_text(node):
    # Independent source extraction: ignore revision markup and reviewer comments.
    return "".join(node.itertext()) if node.tag == W + "t" else (
        "" if node.tag in {W + "del", W + "moveFrom"} else "".join(accepted_text(child) for child in node)
    )


class LegalPublication(unittest.TestCase):
    def test_revised_documents_preserve_all_visible_clauses_in_order(self):
        for slug, title, source_title in publisher.DOCUMENTS:
            with self.subTest(document=slug):
                version = publisher.VERSIONS.get(slug, '2026-10-30')
                filename = 'MyDancr_' + source_title.replace(' ', '_') + '_' + version + '.docx'
                source = ROOT / "public/legal" / filename
                document = json.loads((ROOT / f"src/content/legal/{slug}.json").read_text(encoding="utf-8"))
                self.assertEqual(document["sourceSha256"], sha256(source.read_bytes()).hexdigest())
                self.assertEqual(document["downloadHref"], "/legal/" + filename)
                html = VisibleHTML(document["html"])
                visible = re.sub(r"\s+", "", "".join(html.text))
                cursor = 0
                with ZipFile(source) as archive:
                    body = ET.fromstring(archive.read("word/document.xml")).find(W + "body")
                    for index, block in enumerate(body):
                        text = accepted_text(block)
                        if text.strip() == 'MyDancr ' + source_title:
                            continue
                        text = re.sub(r"\s+", "", text)
                        if not text:
                            continue
                        start = visible.find(text, cursor)
                        self.assertGreaterEqual(start, 0, f"Missing or reordered clause {index}: {text[:100]}")
                        cursor = start + len(text)
                self.assertEqual(len(html.ids), len(set(html.ids)))
                for section in document["contents"]:
                    self.assertIn(section["id"], html.ids)
                for link in html.links:
                    if link.startswith("#"):
                        self.assertIn(link[1:], html.ids)

    def test_only_public_documents_are_published_including_completed_dmca(self):
        self.assertEqual(len(publisher.DOCUMENTS), 10)
        self.assertIn('dmca', [item[0] for item in publisher.DOCUMENTS])
        internal = ['Implementation Guide', 'Content Safety and Rights Procedure',
                    'Data Inventory and Retention Schedule', 'Vendor Contract and Data Access Register']
        for path in (ROOT / 'public').rglob('*'):
            for title in internal:
                self.assertNotIn(title.lower(), path.name.replace('_', ' ').lower())
        document = json.loads((ROOT / 'src/content/legal/dmca.json').read_text(encoding='utf-8'))
        self.assertEqual(document['version'], '2026-10-31')
        self.assertNotIn('[Registered DMCA agent', document['html'])

    def test_tracked_deletions_are_excluded_and_insertions_are_included(self):
        paragraph = ET.fromstring(f'<w:p xmlns:w="{W[1:-1]}"><w:del><w:r><w:t>Old text</w:t></w:r></w:del>'
                                 '<w:ins><w:r><w:t>Revised &amp; &lt;escaped&gt; text</w:t></w:r></w:ins></w:p>')
        self.assertEqual(publisher.inline(publisher.text(paragraph)), "Revised &amp; &lt;escaped&gt; text")

    def test_versioned_contracts_remain_exact_snapshots(self):
        for slug in ['user-terms', 'dancer-agreement', 'vip-table', 'dancer-verification']:
            current = json.loads((ROOT / f'src/content/legal/{slug}.json').read_text(encoding='utf-8'))
            archived = json.loads((ROOT / f'src/content/legal/{slug}-2026-10-30.json').read_text(encoding='utf-8'))
            self.assertEqual(current, archived)


if __name__ == "__main__":
    unittest.main()
