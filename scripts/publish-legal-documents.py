"""Convert the supplied legal Word files to escaped, static website content.

Run with the bundled Python runtime. Originals live in public/legal; accepted
insertions are included and tracked deletions are excluded from the web text.
Legacy DOC extraction requires the optional olefile Python package.
"""

from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
import struct
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"
DOCUMENTS = [
    ("dancer-agreement", "Dancer Agreement", "MyDancr_DancerAgreement.09.17.26v.4.docx"),
    ("privacy", "Privacy Policy", "MyDancr_Privacy_Policy.09.06.26.docx"),
    ("california-privacy", "Privacy Notice for California Residents", "MyDancr_Privacy_Policy_Cal_Amendment.09.06.26.docx"),
    ("dmca", "Digital Millennium Copyright Act", "MyDancr_Digital Millennium Copyright Act.09.06.26.doc"),
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


def legacy_word_body(source):
    """Read the main story of the supplied Word 97–2003 file, not field commands."""
    import olefile

    with olefile.OleFileIO(source) as archive:
        word = archive.openstream("WordDocument").read()
        flags = struct.unpack_from("<H", word, 10)[0]
        if flags & 0x100:
            raise ValueError("Encrypted Word documents are not supported")
        table = archive.openstream("1Table" if flags & 0x200 else "0Table").read()
        start, size = struct.unpack_from("<II", word, 0x1A2)
        clx = table[start:start + size]
        offset = 0
        while clx[offset] == 1:
            offset += 3 + struct.unpack_from("<H", clx, offset + 1)[0]
        if clx[offset] != 2:
            raise ValueError("Missing Word piece table")
        length = struct.unpack_from("<I", clx, offset + 1)[0]
        pieces = clx[offset + 5:offset + 5 + length]
        count = (length - 4) // 12
        positions = struct.unpack_from("<" + "I" * (count + 1), pieces)
        text = ""
        for index in range(count):
            position = struct.unpack_from("<I", pieces, 4 * (count + 1) + 8 * index + 2)[0]
            compressed = bool(position & 0x40000000)
            position &= 0x3FFFFFFF
            chars = positions[index + 1] - positions[index]
            if compressed:
                position //= 2
                text += word[position:position + chars].decode("cp1252")
            else:
                text += word[position:position + chars * 2].decode("utf-16le")
        text = text[:struct.unpack_from("<I", word, 0x4C)[0]]
    # Word stores both instructions and displayed results for hyperlink fields.
    text = re.sub(r"\x13[^\x13\x14\x15]*\x14([^\x13\x15]*)\x15", r"\1", text)
    if any(character in text for character in "\x13\x14\x15"):
        raise ValueError("Unresolved Word field; inspect the source before publishing")
    body = ET.Element(W + "body")
    for paragraph in text.split("\r"):
        ET.SubElement(ET.SubElement(body, W + "p"), W + "t").text = paragraph
    return body


def cookie_table(image_bytes):
    """Publish the source's embedded cookie-table image as accessible text."""
    data = json.loads((ROOT / "src/content/legal/privacy-cookie-table.json").read_text(encoding="utf-8"))
    if sha256(image_bytes).hexdigest() != data["sourceImageSha256"]:
        raise ValueError("The cookie image changed; verify its table transcription")
    headers = "".join(f'<th scope="col">{escape(value)}</th>' for value in data["headers"])
    rows = "".join("<tr>" + "".join(f"<td>{escape(value)}</td>" for value in row) + "</tr>" for row in data["rows"])
    return ('<div class="legal-table-scroll" role="region" aria-label="Cookies used by MyDancr" tabindex="0" data-global-navigation-swipe="ignore">'
            f'<table class="legal-cookie-table"><thead><tr>{headers}</tr></thead><tbody>{rows}</tbody></table></div>'
            f'<p>{escape(data["note"])}</p>')


def convert(slug, title, filename):
    source = ROOT / "public" / "legal" / filename
    image_bytes = None
    if source.suffix == ".doc":
        body = legacy_word_body(source)
    else:
        with ZipFile(source) as archive:
            body = ET.fromstring(archive.read("word/document.xml")).find("w:body", NS)
            if slug == "privacy":
                image_bytes = archive.read("word/media/image1.png")
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
        if slug == "privacy" and block.find(".//w:drawing", NS) is not None:
            html.append(cookie_table(image_bytes))
        text = final_text(block).strip()
        if not text or (index == 0 and text == title):
            continue
        # Both placeholder replacements were confirmed by the document owner.
        if slug == "privacy" and text == "Last updated: September __, 2026":
            text = "Last updated: September 21, 2026"
        if slug == "privacy":
            text = text.replace("XXXXXXXXXX", "MyDancr LLC")
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
