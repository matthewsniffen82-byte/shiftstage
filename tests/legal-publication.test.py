"""Focused publication checks; run with the bundled Python runtime."""
from hashlib import sha256
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publisher", ROOT / "scripts/publish-legal-documents.py")
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
        for slug, title, filename in publisher.DOCUMENTS:
            with self.subTest(document=slug):
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
                        if slug == "privacy":
                            # Retain the existing owner-approved company-name substitution.
                            text = text.replace("XXXXXXXXXX", "MyDancr LLC")
                        if index == 0 and text.strip().casefold() == title.casefold():
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

    def test_club_roman_subclauses_and_revised_operating_terms_are_published(self):
        club = json.loads((ROOT / "src/content/legal/club-agreement.json").read_text(encoding="utf-8"))
        self.assertIn("<p>i. hire, attempt to hire", club["html"])
        self.assertIn("<p>ii. encourage or assist", club["html"])
        self.assertIn("5A. Internal Roster and VIP Requests.", club["html"])
        self.assertIn("Table QR links open the roster immediately", club["html"])

    def test_tracked_deletions_are_excluded_and_insertions_are_included(self):
        paragraph = ET.fromstring(f'<w:p xmlns:w="{W[1:-1]}"><w:del><w:r><w:t>Old text</w:t></w:r></w:del>'
                                 '<w:ins><w:r><w:t>Revised &amp; &lt;escaped&gt; text</w:t></w:r></w:ins></w:p>')
        self.assertEqual(publisher.inline(publisher.final_text(paragraph)), "Revised &amp; &lt;escaped&gt; text")

    def test_california_categories_and_cookie_disclosures_match_the_product(self):
        from lxml import html
        ca = html.fromstring(json.loads((ROOT / "src/content/legal/california-privacy.json").read_text(encoding="utf-8"))["html"])
        categories = {row.xpath("./td[1]/p/text()")[0]: row.xpath("./td[last()]/p/text()")[0] for row in ca.xpath("//tbody/tr")}
        self.assertEqual(categories["D. Commercial information."], "YES")
        self.assertEqual(categories["H. Sensory data."], "YES")
        privacy = html.fromstring(json.loads((ROOT / "src/content/legal/privacy.json").read_text(encoding="utf-8"))["html"])
        self.assertEqual(len(privacy.xpath("//table")), 1)
        for cookie in ["mydancrAdmissionSession", "mydancr_nfc_account_v1", "mydancrVenueVideo"]:
            self.assertIn(cookie, privacy.text_content())


if __name__ == "__main__":
    unittest.main()
