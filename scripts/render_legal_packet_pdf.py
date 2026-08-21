from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


VIOLET = colors.HexColor("#5B16E8")
DEEP_VIOLET = colors.HexColor("#25105A")
CYAN = colors.HexColor("#14CFF2")
INK = colors.HexColor("#17131F")
MUTED = colors.HexColor("#696374")
PALE = colors.HexColor("#F6F3FA")
LINE = colors.HexColor("#DDD6E7")
BLACK = colors.HexColor("#07060A")
WHITE = colors.white
GREEN = colors.HexColor("#0B7A55")
RED = colors.HexColor("#A92B4A")


class AccentRule(Flowable):
    def __init__(self, width: float, violet_ratio: float = 0.78):
        super().__init__()
        self.width = width
        self.height = 4
        self.violet_ratio = violet_ratio

    def draw(self) -> None:
        split = self.width * self.violet_ratio
        self.canv.setFillColor(VIOLET)
        self.canv.rect(0, 0, split, self.height, stroke=0, fill=1)
        self.canv.setFillColor(CYAN)
        self.canv.rect(split, 0, self.width - split, self.height, stroke=0, fill=1)


def inline_markup(value: str) -> str:
    escaped = html.escape(value, quote=False)
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda m: f'<link href="{html.escape(m.group(2), quote=True)}" color="#3B19A8"><u>{m.group(1)}</u></link>',
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = escaped.replace("  ", " ")
    return escaped


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.1,
            leading=12.5,
            textColor=INK,
            spaceAfter=6.5,
            allowWidows=0,
            allowOrphans=0,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=21,
            textColor=BLACK,
            spaceBefore=5,
            spaceAfter=10,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=15,
            textColor=DEEP_VIOLET,
            spaceBefore=8,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.2,
            leading=13,
            textColor=INK,
            spaceBefore=6,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.9,
            leading=12.2,
            leftIndent=14,
            firstLineIndent=-8,
            textColor=INK,
            spaceAfter=4,
        ),
        "number": ParagraphStyle(
            "Number",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.9,
            leading=12.2,
            leftIndent=20,
            firstLineIndent=-16,
            textColor=INK,
            spaceAfter=4.5,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=9.2,
            textColor=INK,
        ),
        "small_bold": ParagraphStyle(
            "SmallBold",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.1,
            leading=9,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
        "callout_title": ParagraphStyle(
            "CalloutTitle",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.4,
            leading=10.5,
            textColor=DEEP_VIOLET,
            spaceAfter=3,
        ),
        "callout_body": ParagraphStyle(
            "CalloutBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.4,
            leading=11.2,
            textColor=INK,
        ),
    }


def add_cover(story: list, styles: dict[str, ParagraphStyle], content_width: float) -> None:
    story.append(Spacer(1, 0.28 * inch))
    brand = Paragraph(
        '<font name="Helvetica-Bold" size="16" color="#5B16E8">mydancr</font>',
        ParagraphStyle("Brand", alignment=TA_LEFT, leading=20),
    )
    story.append(brand)
    story.append(Spacer(1, 0.18 * inch))

    title = Paragraph(
        '<font name="Helvetica-Bold" size="29" color="#FFFFFF">LEGAL REVIEW<br/>PACKET</font>'
        '<br/><br/><font name="Helvetica-Bold" size="12" color="#C4F5FF">'
        "Factual Product Map + Draft Agreements and Policies</font>",
        ParagraphStyle("CoverTitle", leading=32, leftIndent=4, rightIndent=4),
    )
    panel = Table([[title]], colWidths=[content_width], rowHeights=[2.34 * inch])
    panel.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLACK),
                ("BOX", (0, 0), (-1, -1), 1.6, VIOLET),
                ("LINEBELOW", (0, 0), (-1, -1), 2.2, CYAN),
                ("LEFTPADDING", (0, 0), (-1, -1), 24),
                ("RIGHTPADDING", (0, 0), (-1, -1), 24),
                ("TOPPADDING", (0, 0), (-1, -1), 28),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 24),
            ]
        )
    )
    story.append(panel)
    story.append(Spacer(1, 0.28 * inch))

    label = ParagraphStyle("MetaLabel", fontName="Helvetica-Bold", fontSize=7.2, textColor=VIOLET, leading=9)
    value = ParagraphStyle("MetaValue", fontName="Helvetica", fontSize=9.4, textColor=INK, leading=11)
    meta_rows = []
    for left, right in [
        ("PREPARED FOR", "Specialist adult-entertainment counsel"),
        ("PRODUCT", "MyDancr · mobile-first web application"),
        ("REVIEW DATE", "August 21, 2026"),
        ("PILOT", "Arizona · city/county to be selected after local review"),
        ("STATUS", "Attorney review draft · not approved for publication"),
    ]:
        meta_rows.append([Paragraph(left, label), Paragraph(right, value)])
    meta = Table(meta_rows, colWidths=[1.5 * inch, content_width - 1.5 * inch])
    meta.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(meta)
    story.append(Spacer(1, 0.28 * inch))
    note_style = ParagraphStyle(
        "CoverNote",
        parent=styles["body"],
        fontName="Helvetica-Oblique",
        fontSize=8.5,
        leading=11.5,
        alignment=TA_CENTER,
        textColor=MUTED,
        leftIndent=28,
        rightIndent=28,
    )
    story.append(
        Paragraph(
            "This packet is a product-informed drafting aid for licensed counsel. It is not legal advice, a legal opinion, or a substitute for jurisdiction-specific review.",
            note_style,
        )
    )
    story.append(PageBreak())


def callout(kind: str, title: str, text: str, styles: dict[str, ParagraphStyle], width: float) -> Table:
    kind_upper = kind.upper()
    accent = CYAN if kind_upper == "PRODUCT FACT" else GREEN if kind_upper == "IMPLEMENTATION" else VIOLET
    if kind_upper == "HIGH RISK":
        accent = RED
    heading = Paragraph(f'<font color="{accent.hexval()}">{html.escape(kind_upper)} · {html.escape(title)}</font>', styles["callout_title"])
    body = Paragraph(inline_markup(text), styles["callout_body"])
    table = Table([[heading], [body]], colWidths=[width - 8])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.7, accent),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
            ]
        )
    )
    return table


def flow_table(styles: dict[str, ParagraphStyle], width: float) -> Table:
    rows = [
        ("Customer signs up", "Email, city, auth metadata", "Supabase Auth + customer role", "Customer dashboard", "Confirmation, rate limit, RLS"),
        ("Dancer signs up", "Email, city, profile fields", "Auth + hosted Yoti 18+ gate + MyDancr eligibility", "Private dancer workspace", "Minimal verification decision + audit"),
        ("Dancer uploads media", "Image/video + technical metadata", "Validation, transform/watermark, automated/human moderation", "Approved public media or private review", "Storage + moderation decision"),
        ("Dancer submits", "Profile + approved media", "Eligibility checks; first club verification remains required", "Pending/approved state", "Approval audit + notice"),
        ("Dressing-room NFC", "Tag, dancer, club, device/IP", "Secure tag + affiliation/presence validation", "Affiliation + time-limited Working Now", "Tap, expiry, cooldown, audit"),
        ("Dancer posts shift", "Approved affiliated club + date/time", "Venue restricted to active affiliation", "Public upcoming schedule", "Shift + notification + analytics"),
        ("Customer discovers", "City/filter + session context", "Public eligibility + ranking queries", "Dancer/club/TV results", "View/ranking events"),
        ("Club publishes deal", "Allowed offer + accepted offer-specific Deal Order", "Authorization, policy, fee and active-deal checks", "Public Club Deal", "Deal Order + fee snapshot + audit"),
        ("Customer selects deal", "Deal + source + dancer/shift when eligible", "Signed token; immutable source locked", "Cashier redemption screen", "Redemption + attribution"),
        ("Cashier NFC", "Cashier tag + token + session/device", "Club/deal/expiry/duplicate checks", "Verified redemption", "NFC + redemption + fraud audit"),
        ("Commission accrues", "Profile-originated redemption + negotiated deal fee", "Monthly 1–9: 30%; 10–24: 40%; 25+: 50%", "Dancer commission eligible for export", "Deal Order + ordinal + policy snapshot"),
        ("Commission exported", "Verified NATS affiliate ID + exact USD amount", "Durable outbox; ambiguous response requires reconciliation", "Too Much Media/NATS", "Status + provider reference + reversal"),
        ("Club settles weekly", "Itemized statement + ACH authorization/instructions", "ACH debit/credit + return and reconciliation", "MyDancr receivable settled", "Statement/item + ACH trace/status"),
        ("Notification", "Recipient + event + channel preference", "In-app plus optional push/email", "Account holder", "Delivery state + opt-out"),
        ("Report/support", "Target + category + description", "Triage, moderation, escalation, response", "Admin/support queue", "Case + messages + actions"),
        ("Account deletion", "Authenticated request", "Public removal + storage/provider cleanup subject to holds", "Access disabled", "Minimal finance, fraud, DMCA, tax/legal records"),
    ]
    headers = ["FLOW", "INPUTS", "PROCESSING / DECISION", "OUTPUT / RECIPIENT", "RECORD / CONTROL"]
    data = [[Paragraph(h, styles["small_bold"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(inline_markup(cell), styles["small"]) for cell in row])
    col_widths = [0.88 * inch, 1.22 * inch, 1.72 * inch, 1.2 * inch, width - 5.02 * inch]
    table = Table(data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DEEP_VIOLET),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ]
        )
    )
    return table


def render_markdown(source: str, story: list, styles: dict[str, ParagraphStyle], width: float) -> None:
    lines = source.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---PAGE---":
            story.append(PageBreak())
            i += 1
            continue
        if stripped == "[[FLOW_MATRIX]]":
            story.append(Paragraph("End-to-end data and money flow matrix", styles["h1"]))
            story.append(Paragraph("The matrix separates user input, server decisioning, recipient/output, and durable evidence for each material flow.", styles["body"]))
            story.append(flow_table(styles, width))
            i += 1
            continue
        match = re.match(r"^\[CALLOUT:([^|]+)\|([^\]]+)\]\s*(.*)$", stripped)
        if match:
            story.append(KeepTogether([callout(match.group(1), match.group(2), match.group(3), styles, width), Spacer(1, 7)]))
            i += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), styles["h3"]))
            i += 1
            continue
        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), styles["h2"]))
            i += 1
            continue
        if stripped.startswith("# "):
            story.append(AccentRule(width))
            story.append(Spacer(1, 5))
            story.append(Paragraph(inline_markup(stripped[2:]), styles["h1"]))
            i += 1
            continue
        if stripped.startswith("- "):
            story.append(Paragraph("• " + inline_markup(stripped[2:]), styles["bullet"]))
            i += 1
            continue
        numbered = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if numbered:
            story.append(Paragraph(f"{numbered.group(1)}. " + inline_markup(numbered.group(2)), styles["number"]))
            i += 1
            continue
        if stripped.startswith("> "):
            quote_style = ParagraphStyle(
                "Quote",
                parent=styles["body"],
                leftIndent=14,
                rightIndent=8,
                textColor=MUTED,
                borderColor=CYAN,
                borderWidth=0,
                borderPadding=5,
            )
            story.append(Paragraph(inline_markup(stripped[2:]), quote_style))
            i += 1
            continue

        paragraph_lines = [stripped]
        j = i + 1
        while j < len(lines):
            candidate = lines[j].strip()
            if not candidate or candidate.startswith(("#", "- ", "> ", "[CALLOUT:", "---PAGE---", "[[FLOW_MATRIX]]")) or re.match(r"^\d+\.\s+", candidate):
                break
            paragraph_lines.append(candidate)
            j += 1
        story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), styles["body"]))
        i = j


class LegalPacketDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=letter,
            leftMargin=0.55 * inch,
            rightMargin=0.55 * inch,
            topMargin=0.62 * inch,
            bottomMargin=0.58 * inch,
            title="MyDancr Legal Review Packet",
            author="MyDancr",
            subject="Product-informed drafts for specialist attorney review",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="main", frames=frame, onPage=self._decorate))

    def _decorate(self, canvas, doc) -> None:
        page = canvas.getPageNumber()
        canvas.saveState()
        if page > 1:
            canvas.setStrokeColor(VIOLET)
            canvas.setLineWidth(1.2)
            canvas.line(self.leftMargin, letter[1] - 0.35 * inch, letter[0] - self.rightMargin, letter[1] - 0.35 * inch)
            canvas.setFont("Helvetica-Bold", 7)
            canvas.setFillColor(DEEP_VIOLET)
            canvas.drawString(self.leftMargin, letter[1] - 0.27 * inch, "MYDANCR  /  ATTORNEY REVIEW DRAFT")
            canvas.setFont("Helvetica", 7)
            canvas.setFillColor(MUTED)
            footer = "Confidential working draft · Not approved for publication"
            canvas.drawString(self.leftMargin, 0.27 * inch, footer)
            page_text = str(page - 1)
            canvas.drawRightString(letter[0] - self.rightMargin, 0.27 * inch, page_text)
        canvas.restoreState()


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render_legal_packet_pdf.py SOURCE.md OUTPUT.pdf")
    source_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    styles = make_styles()
    doc = LegalPacketDoc(str(output_path))
    story: list = []
    add_cover(story, styles, doc.width)
    render_markdown(source_path.read_text(encoding="utf-8"), story, styles, doc.width)
    doc.build(story)
    print(output_path)


if __name__ == "__main__":
    main()
