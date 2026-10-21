"""Combine the operations manual and four cheat sheets, preserving pages and links."""
from io import BytesIO
from pathlib import Path
import hashlib
import json

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import ArrayObject, NameObject
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/mydancr-operations"
QA = ROOT / "tmp/pdfs/operations-packet"
SECTIONS = [
    ("Operations manual", "MyDancr_Operations_Manual.pdf", 27),
    ("Club Admin - one-page cheat sheet", "MyDancr_Club_Admin_Cheat_Sheet.pdf", 1),
    ("Managers & talent - one-page cheat sheet", "MyDancr_Manager_Talent_Cheat_Sheet.pdf", 1),
    ("Dancers - one-page cheat sheet", "MyDancr_Dancer_Cheat_Sheet.pdf", 1),
    ("Content approval - one-page cheat sheet", "MyDancr_Content_Approval_Cheat_Sheet.pdf", 1),
]


def page_number(reader, destination):
    if isinstance(destination, str):
        destination = reader.named_destinations[destination].dest_array
    ref = destination[0]
    return next(i for i, page in enumerate(reader.pages)
                if page.indirect_reference.idnum == ref.idnum)


def main():
    QA.mkdir(parents=True, exist_ok=True)
    sections = []
    offset = 1
    for label, filename, expected in SECTIONS:
        path = OUT / filename
        reader = PdfReader(path)
        assert len(reader.pages) == expected, filename
        sections.append(dict(label=label, filename=filename, reader=reader, offset=offset,
                             count=expected, hash=hashlib.sha256(path.read_bytes()).hexdigest()))
        offset += expected
    total = offset

    cover = BytesIO()
    c = canvas.Canvas(cover, pagesize=(612, 792), pageCompression=1)
    c.setFillColor(HexColor("#6736B6")); c.setFont("Helvetica-Bold", 10)
    c.drawString(42, 750, "MYDANCR / OPERATIONS PACKET")
    c.setFillColor(HexColor("#17151E")); c.setFont("Helvetica-Bold", 28)
    c.drawString(42, 703, "Operations & quick reference")
    c.setFont("Helvetica", 12)
    c.drawString(42, 675, "The operations manual and four one-page cheat sheets in one PDF.")
    c.setFont("Helvetica", 10)
    c.drawString(42, 642, "Select a section below, or use the PDF bookmarks to jump to a task.")
    links = []
    y = 607
    for index, section in enumerate(sections):
        c.setFillColor(HexColor("#F1ECF8") if index % 2 == 0 else HexColor("#FFFFFF"))
        c.roundRect(42, y - 29, 528, 36, 4, stroke=0, fill=1)
        c.setFillColor(HexColor("#17151E")); c.setFont("Helvetica-Bold", 10.5)
        c.drawString(54, y - 14, section["label"])
        c.setFillColor(HexColor("#6736B6")); c.setFont("Helvetica", 10)
        start, end = section["offset"] + 1, section["offset"] + section["count"]
        c.drawRightString(558, y - 14, str(start) if start == end else f"{start}-{end}")
        links.append(((42, y - 29, 570, y + 7), section["offset"]))
        y -= 43
    c.setFillColor(HexColor("#17151E")); c.setFont("Helvetica-Bold", 10)
    c.drawString(42, 365, "Using this packet")
    c.setFont("Helvetica", 10)
    for line, yy in [
        ("The contents numbers above match your PDF viewer's page counter.", 346),
        ("Original section page numbers are retained so existing references still work.", 331),
        ("Keep the complete packet with club leadership; share only dancer handouts", 306),
        ("with dancers. Management performance details are not dancer training.", 291),
    ]:
        c.drawString(42, yy, line)
    c.setFillColor(HexColor("#6736B6")); c.setFont("Helvetica", 9)
    c.drawString(42, 79, "Help: support@mydancr.com  |  www.mydancr.com/guides")
    c.linkURL("mailto:support@mydancr.com", (42, 77, 176, 91), relative=0)
    c.linkURL("https://www.mydancr.com/guides", (190, 77, 332, 91), relative=0)
    c.setStrokeColor(HexColor("#DDD8E3")); c.line(42, 53, 570, 53)
    c.setFillColor(HexColor("#55515D")); c.setFont("Helvetica", 8)
    c.drawString(42, 36, "MyDancr | Complete operations packet | 20 October 2026")
    c.drawRightString(570, 36, f"1 / {total}")
    c.showPage(); c.save(); cover.seek(0)

    writer = PdfWriter()
    writer.append(PdfReader(cover))
    writer.add_outline_item("Start here - packet contents", 0)
    for section in sections:
        writer.append(section["reader"], outline_item=section["label"], import_outline=True)
    for rect, target in links:
        annotation = writer.add_annotation(0, Link(rect=rect, target_page_index=target))
        annotation[NameObject("/Dest")] = ArrayObject([writer.pages[target].indirect_reference, NameObject("/Fit")])
    writer.add_metadata({"/Title": "MyDancr - Operations Manual & Quick Reference",
                         "/Author": "MyDancr Operations",
                         "/Subject": "Club operations manual and four one-page role cheat sheets"})
    writer.page_mode = "/UseOutlines"
    # Identical images/fonts recur in the handouts. Deduplicate without resampling.
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    destination = OUT / "MyDancr_Complete_Operations_Packet.pdf"
    with destination.open("wb") as handle:
        writer.write(handle)

    result = PdfReader(destination)
    assert len(result.pages) == total
    assert destination.stat().st_size < 4_000_000, "Packet must fit the private binary download response"
    internal_links = 0
    for section in sections:
        assert hashlib.sha256((OUT / section["filename"]).read_bytes()).hexdigest() == section["hash"]
        for n, source_page in enumerate(section["reader"].pages):
            combined_page = result.pages[section["offset"] + n]
            assert source_page.extract_text() == combined_page.extract_text(), (section["label"], n)
            original_links = source_page.get("/Annots", [])
            combined_links = combined_page.get("/Annots", [])
            assert len(original_links) == len(combined_links), (section["label"], n, "annotations")
            for old_ref, new_ref in zip(original_links, combined_links):
                old, new = old_ref.get_object(), new_ref.get_object()
                if "/Dest" in old:
                    expected_page = section["offset"] + page_number(section["reader"], old["/Dest"])
                    assert page_number(result, new["/Dest"]) == expected_page
                    internal_links += 1
                elif "/A" in old:
                    assert old["/A"].get("/URI") == new["/A"].get("/URI")
    for _, target in links:
        assert any(page_number(result, a.get_object()["/Dest"]) == target
                   for a in result.pages[0]["/Annots"] if "/Dest" in a.get_object())
    def flatten_outline(items):
        for item in items:
            if isinstance(item, list):
                yield from flatten_outline(item)
            else:
                yield item
    bookmarks = list(flatten_outline(result.outline))
    assert len(bookmarks) == 1 + len(sections) + sum(len(list(flatten_outline(s["reader"].outline))) for s in sections)
    for section in sections:
        assert any(b.title == section["label"] and result.get_destination_page_number(b) == section["offset"] for b in bookmarks)
        for original in flatten_outline(section["reader"].outline):
            expected_page = section["offset"] + section["reader"].get_destination_page_number(original)
            assert any(b.title == original.title and result.get_destination_page_number(b) == expected_page for b in bookmarks)
    report = {"passed": True, "pages": total, "bytes": destination.stat().st_size,
              "preserved_internal_links": internal_links, "contents_links": len(links), "bookmarks": len(bookmarks),
              "sections": [{k: v for k, v in s.items() if k != "reader"} for s in sections]}
    (QA / "validation.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "sections"}, indent=2))


if __name__ == "__main__":
    main()
