"""Convert the supplied legal DOCX files to escaped, static website content.

Run with the bundled Python runtime. Originals live in public/legal; accepted
insertions are included and tracked deletions are excluded from the web text.
"""

from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"
DOCUMENTS = [
    ("dmca", "Digital Millennium Copyright Act", "MyDancr_Digital Millennium Copyright Act.09.06.26.docx"),
    ("dancer-agreement", "Dancer Agreement", "MyDancr_DancerAgreement.09.17.26v.4.docx"),
    ("privacy", "Privacy Policy", "MyDancr_Privacy_Policy.09.06.26.docx"),
    ("california-privacy", "Privacy Notice for California Residents", "MyDancr_Privacy_Policy_Cal_Amendment.09.06.26.docx"),
]
SUBHEADINGS = {
    "Infringement Notification", "Counter Notification",
    "Personal information you disclose to us", "Information automatically collected",
    "Information collected from other sources", "Account Information",
    "How do we use and share your personal information?", "Will your information be shared with anyone else?",
    "California Residents", "Colorado Residents", "Connecticut Residents", "Utah Residents", "Virginia Residents",
    "CCPA Privacy Notice", "Your rights with respect to your personal data", "Verification process",
    "Other privacy rights", "Right to appeal", "Exercise your rights provided under the Virginia VCDPA",
    "Access to Specific Information and Data Portability Rights", "Deletion Request Rights",
    "Response Timing and Format", "Personal Information Sales",
}


def final_text(element):
    if element.tag in {W + "del", W + "moveFrom"}:
        return ""
    if element.tag == W + "t":
        return element.text or ""
    if element.tag in {W + "tab", W + "br"}:
        return " "
    return "".join(final_text(child) for child in element)


def inline(text):
    """Link only visible email addresses, web URLs, and the supplied addendum reference."""
    pattern = r"https?://[^\s<>\"')\]]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\[California Privacy Addendum\]"
    result, start = [], 0
    for match in re.finditer(pattern, text):
        result.append(escape(text[start:match.start()]))
        label = match.group().rstrip(".,;")
        suffix = match.group()[len(label):]
        href = "/privacy/california" if label == "[California Privacy Addendum]" else (
            "mailto:" + label if "@" in label and not label.startswith("http") else label
        )
        result.append(f'<a href="{escape(href, quote=True)}">{escape(label)}</a>{escape(suffix)}')
        start = match.end()
    result.append(escape(text[start:]))
    return "".join(result)


def convert(slug, title, filename):
    source = ROOT / "public" / "legal" / filename
    with ZipFile(source) as archive:
        body = ET.fromstring(archive.read("word/document.xml")).find("w:body", NS)
    html, contents = [], []
    paragraph_index = 0

    def heading(text, anchor=None):
        anchor = anchor or f"{slug}-section-{len(contents) + 1}"
        contents.append({"id": anchor, "title": text})
        return f'<h2 id="{anchor}">{inline(text)}</h2>'

    for block in body:
        if block.tag == W + "tbl":
            rows = []
            for row_index, row in enumerate(block.findall("w:tr", NS)):
                tag = "th" if row_index == 0 else "td"
                scope = ' scope="col"' if row_index == 0 else ""
                cells = []
                for cell in row.findall("w:tc", NS):
                    paragraphs = cell.findall("w:p", NS)
                    paragraph_index += len(paragraphs)
                    cells.append(f'<{tag}{scope}>' + "".join(
                        f"<p>{inline(final_text(p).strip())}</p>" for p in paragraphs if final_text(p).strip()
                    ) + f"</{tag}>")
                rows.append("<tr>" + "".join(cells) + "</tr>")
            html.append('<div class="legal-table-scroll" role="region" aria-label="Categories of personal information" tabindex="0" data-global-navigation-swipe="ignore"><table><thead>'
                        + rows[0] + "</thead><tbody>" + "".join(rows[1:]) + "</tbody></table></div>")
            continue
        if block.tag != W + "p":
            continue
        index = paragraph_index
        paragraph_index += 1
        text = final_text(block).strip()
        if not text or (index == 0 and text == title):
            continue
        # The publication date was explicitly confirmed by the document owner.
        if slug == "privacy" and text == "Last updated: September __, 2026":
            text = "Last updated: September 19, 2026"
        number = re.match(r"^(\d+)\.\s*[A-Z]", text)
        if slug == "privacy" and 18 <= index <= 30:
            html.append(f'<p class="legal-toc-entry"><a href="#privacy-topic-{number[1]}">{inline(text)}</a></p>')
        elif (number and len(text) < 120 and (slug == "california-privacy" or text.upper() == text)):
            html.append(heading(text, f"privacy-topic-{number[1]}" if slug == "privacy" else None))
        elif text in SUBHEADINGS or (text.isupper() and len(text) < 100):
            html.append(heading(text))
        elif slug == "dancer-agreement" and re.match(r"^[A-Z][A-Z /,()&-]+\. ", text):
            label, rest = text.split(". ", 1)
            html.append(heading(label + ".") + f"<p>{inline(rest)}</p>")
        else:
            css = ' class="legal-bullet"' if text.startswith("•") else ""
            html.append(f"<p{css}>{inline(text)}</p>")
    target = ROOT / "src" / "content" / "legal" / f"{slug}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        "title": title,
        "sourceFile": filename,
        "sourceSha256": sha256(source.read_bytes()).hexdigest(),
        "downloadHref": "/legal/" + filename,
        "contents": contents,
        "html": "\n".join(html),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Published {slug}: {len(contents)} headings")


if __name__ == "__main__":
    for document in DOCUMENTS:
        convert(*document)
