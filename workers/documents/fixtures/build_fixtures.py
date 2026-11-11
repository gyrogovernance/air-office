"""Deterministic fixture generator for the document corpus.

Regenerates every generated fixture and rewrites corpus.json with content
hashes and expected extraction behavior. All content is authored here, so the
corpus stays redistribution-safe. Run from the repository root or this
directory: python fixtures/build_fixtures.py
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont
from openpyxl import Workbook
from pptx import Presentation

HERE = Path(__file__).resolve().parent
STAMP = "D:20261011000000+00'00'"


def _metadata(doc: "pymupdf.Document", title: str) -> None:
    doc.set_metadata({
        "title": title,
        "creator": "AIR Office fixture generator",
        "producer": "AIR Office fixture generator",
        "creationDate": STAMP,
        "modDate": STAMP,
    })


def build_clean_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "AIR Office clean extraction sample", fontsize=16, fontname="helv")
    page.insert_textbox(
        pymupdf.Rect(72, 110, 520, 320),
        "This clean extraction sample proves that the packaged worker returns text with stable page anchors. "
        "The paragraph is deliberately plain so normalization cannot hide a regression. "
        "Second sentence mentions draft recovery to keep an editing phrase in the corpus.",
        fontsize=11, fontname="helv",
    )
    _metadata(doc, "Clean extraction sample")
    doc.save(path, deflate=True)
    doc.close()


def build_two_column_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 60), "Two column layout sample", fontsize=14, fontname="helv")
    page.draw_line((300, 75), (300, 760))
    left = "Left column anchor text survives column detection. " * 12
    right = "Right column anchor text survives column detection. " * 12
    page.insert_textbox(pymupdf.Rect(72, 80, 285, 760), left, fontsize=10, fontname="helv")
    page.insert_textbox(pymupdf.Rect(315, 80, 530, 760), right, fontsize=10, fontname="helv")
    _metadata(doc, "Two column sample")
    doc.save(path, deflate=True)
    doc.close()


def build_table_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 60), "Quarterly table sample", fontsize=14, fontname="helv")
    rows = [("Quarter", "Region", "Revenue"), ("Q1", "North", "42"), ("Q2", "South", "57")]
    x0, y0, width, height = 72, 90, 140, 28
    for row_index, row in enumerate(rows):
        for column_index, cell in enumerate(row):
            rect = pymupdf.Rect(x0 + column_index * width, y0 + row_index * height,
                                x0 + (column_index + 1) * width, y0 + (row_index + 1) * height)
            page.draw_rect(rect)
            page.insert_text((rect.x0 + 6, rect.y1 - 9), cell, fontsize=10, fontname="helv")
    page.insert_textbox(
        pymupdf.Rect(72, 220, 520, 320),
        "The table above lists region revenue. A known cell value of 42 must survive extraction.",
        fontsize=11, fontname="helv",
    )
    _metadata(doc, "Table sample")
    doc.save(path, deflate=True)
    doc.close()


def build_long_pdf(path: Path) -> None:
    doc = pymupdf.open()
    for page_number in range(1, 9):
        page = doc.new_page()
        page.insert_text((72, 72), f"Long document page {page_number} opening line.", fontsize=13, fontname="helv")
        body = f"Paragraph on page {page_number} expands the corpus with deterministic prose. " * 30
        page.insert_textbox(pymupdf.Rect(72, 100, 520, 740), body, fontsize=10, fontname="helv")
        if page_number == 8:
            page.insert_text((72, 760), "Long document page eight closing line.", fontsize=13, fontname="helv")
    _metadata(doc, "Long document sample")
    doc.save(path, deflate=True)
    doc.close()


def _ocr_image_bytes(text: str) -> bytes:
    image = Image.new("RGB", (1000, 320), "white")
    draw = ImageDraw.Draw(image)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    font = ImageFont.truetype(str(font_path), 56) if font_path.exists() else ImageFont.load_default()
    draw.text((40, 60), text, fill="black", font=font)
    draw.text((40, 170), "Citation anchors must resolve against this page.", fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def build_scanned_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(40, 40, 560, 400), stream=_ocr_image_bytes("AIR OFFICE SCANNED SAMPLE"))
    _metadata(doc, "Scanned sample")
    doc.save(path, deflate=True)
    doc.close()


def build_corrupt_pdf(path: Path) -> None:
    # A PDF header followed by structurally meaningless bytes: no object table,
    # no xref, nothing for a repairing parser to recover, so conversion fails.
    path.write_bytes(b"%PDF-1.7\n" + bytes(index % 251 for index in range(700)))


def build_encrypted_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Encrypted sample content must refuse without a password.", fontsize=12, fontname="helv")
    _metadata(doc, "Encrypted sample")
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner-password", user_pw="s3cret-sample-password")
    doc.close()


def build_docx(path: Path) -> None:
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly summary</w:t></w:r></w:p>
<w:p><w:r><w:t>Revenue grew by forty-two percent this quarter.</w:t></w:r></w:p>
<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>Target</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t>Closing note: headings and tables must survive conversion.</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>"""
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document_xml)
        archive.writestr("word/styles.xml", styles_xml)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
    # The package must open with a real WordprocessingML reader before it ships.
    from docx import Document  # noqa: E402 - python-docx ships with the engine

    document = Document(str(path))
    texts = [paragraph.text for paragraph in document.paragraphs]
    assert "Quarterly summary" in texts


def build_pptx(path: Path) -> None:
    presentation = Presentation()
    layout = presentation.slide_layouts[1]
    slide = presentation.slides.add_slide(layout)
    slide.shapes.title.text = "AIR Office slide sample"
    slide.placeholders[1].text = "Slide body text must survive extraction."
    presentation.save(str(path))


def build_xlsx(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Revenue"
    sheet.append(["Quarter", "Region", "Revenue"])
    sheet.append(["Q1", "North", 42])
    sheet.append(["Q2", "South", 57])
    workbook.save(str(path))


def build_ocr_image(path: Path) -> None:
    path.write_bytes(_ocr_image_bytes("AIR OFFICE OCR SAMPLE TEXT"))


#: Expected extraction behavior per fixture. requires_engine entries refuse with
#: refusal_without_engine while the optional engine is absent, and assert their
#: full expectations once it is installed.
EXPECTATIONS: dict[str, dict] = {
    "plain-utf8.txt": {"kind": "text", "contains": ["quick brown fox", "Καλημέρα κόσμε", "Draft recovery keeps unsaved edits safe.", "Second paragraph after a blank line."], "warnings": [], "page_count": None},
    "markdown-complex.md": {"kind": "markdown", "contains": ["# Document title", "## Section", "- first item", "const value = 1;"], "warnings": [], "page_count": None},
    "html-navigation.html": {"kind": "html", "contains": ["Visible heading", "Visible paragraph text."], "not_contains": ["Navigation links", "console.log", "Site footer", "Site header"], "warnings": [], "page_count": None},
    "mixed-direction.txt": {"kind": "text", "contains": ["English then العربية then back to English.", "עברית followed by more text."], "warnings": [], "page_count": None},
    "invalid-encoding.txt": {"kind": "text", "contains": [], "warnings": ["corrupt"], "page_count": None},
    "empty.txt": {"kind": "text", "contains": [], "warnings": ["empty-content"], "page_count": None},
    "code-listing.txt": {"kind": "text", "contains": ["def sanitize(root: str, candidate: str) -> str:", "path escapes the authorized root", "return joined"], "warnings": [], "page_count": None},
    "duplicate-plain.txt": {"kind": "text", "duplicate_of": "plain-utf8.txt", "contains": ["quick brown fox"], "warnings": [], "page_count": None},
    "revision-v1.md": {"kind": "markdown", "contains": ["# Revision history", "Draft revision one records every source version immutably."], "warnings": [], "page_count": None},
    "revision-v2.md": {"kind": "markdown", "contains": ["# Revision history", "Final revision two resolves citations against the stored extraction artifact."], "warnings": [], "page_count": None},
    "clean.pdf": {"kind": "pdf", "contains": ["AIR Office clean extraction sample", "stable page anchors", "draft recovery"], "warnings": [], "page_count": 1},
    "two-column.pdf": {"kind": "pdf", "contains": ["Two column layout sample", "Left column anchor text", "Right column anchor text"], "warnings": [], "page_count": 1},
    "table.pdf": {"kind": "pdf", "contains": ["Quarterly table sample", "Quarter", "North", "known cell value of 42"], "warnings": [], "page_count": 1},
    "long.pdf": {"kind": "pdf", "contains": ["Long document page 1 opening line.", "Long document page eight closing line."], "warnings": [], "page_count": 8},
    "scanned.pdf": {"kind": "pdf", "requires_engine": True, "ocr_sample": True, "contains": ["AIR OFFICE SCANNED SAMPLE"], "warnings_any": ["empty-content", "ocr-low-confidence"], "page_count": 1},
    "corrupt.pdf": {"kind": "pdf", "requires_engine": True, "contains": [], "warnings_any": ["corrupt", "empty-content", "unsupported-format"], "page_count": None},
    "encrypted.pdf": {"kind": "pdf", "requires_engine": True, "contains": [], "warnings_any": ["corrupt", "unsupported-format", "empty-content"], "page_count": None},
    "headings-table.docx": {"kind": "docx", "requires_engine": True, "contains": ["Quarterly summary", "Revenue grew by forty-two percent", "North"], "warnings": [], "page_count": None},
    "slides.pptx": {"worker_kind": "unsupported", "contains": ["AIR Office slide sample"], "note": "PPTX is refused by the protocol until the source-kind mapping supports it."},
    "sheet.xlsx": {"worker_kind": "unsupported", "contains": ["Q1", "North", "42"], "note": "Spreadsheet material is refused by the protocol until the source-kind mapping supports it."},
    "ocr-sample.png": {"kind": "image", "requires_engine": True, "ocr_sample": True, "contains": ["AIR OFFICE OCR SAMPLE TEXT"], "warnings_any": ["empty-content", "ocr-low-confidence"], "page_count": None},
    "unsupported.bin": {"kind": "pdf", "requires_engine": True, "contains": [], "warnings_any": ["corrupt", "unsupported-format", "empty-content"], "page_count": None},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    build_clean_pdf(HERE / "clean.pdf")
    build_two_column_pdf(HERE / "two-column.pdf")
    build_table_pdf(HERE / "table.pdf")
    build_long_pdf(HERE / "long.pdf")
    build_scanned_pdf(HERE / "scanned.pdf")
    build_corrupt_pdf(HERE / "corrupt.pdf")
    build_encrypted_pdf(HERE / "encrypted.pdf")
    build_docx(HERE / "headings-table.docx")
    build_pptx(HERE / "slides.pptx")
    build_xlsx(HERE / "sheet.xlsx")
    build_ocr_image(HERE / "ocr-sample.png")
    (HERE / "code-listing.txt").write_text(
        'def sanitize(root: str, candidate: str) -> str:\n'
        '    """Join and containment check for untrusted relative paths."""\n'
        "    joined = os.path.normpath(os.path.join(root, candidate))\n"
        '    if os.path.commonpath([root, joined]) != root:\n'
        '        raise ValueError("path escapes the authorized root")\n'
        "    return joined\n",
        encoding="utf-8",
    )
    (HERE / "duplicate-plain.txt").write_bytes((HERE / "plain-utf8.txt").read_bytes())
    (HERE / "revision-v1.md").write_text(
        "# Revision history\n\nDraft revision one records every source version immutably.\n\nThe pipeline keeps the original bytes behind a content hash.\n",
        encoding="utf-8",
    )
    (HERE / "revision-v2.md").write_text(
        "# Revision history\n\nFinal revision two resolves citations against the stored extraction artifact.\n\nThe pipeline keeps the original bytes behind a content hash.\n",
        encoding="utf-8",
    )

    fixtures = []
    for name, expectation in sorted(EXPECTATIONS.items()):
        file_path = HERE / name
        if not file_path.exists():
            raise SystemExit(f"Missing fixture {name}; the generator must create every declared entry.")
        entry = {"file": name, "sha256": sha256(file_path), "bytes": file_path.stat().st_size, **expectation}
        fixtures.append(entry)
    corpus = {
        "schema_version": 1,
        "generated_by": "fixtures/build_fixtures.py",
        "engine": "docling (optional; pdf, docx and image entries refuse without it)",
        "fixtures": fixtures,
    }
    (HERE / "corpus.json").write_text(json.dumps(corpus, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(fixtures)} corpus entries")


if __name__ == "__main__":
    main()
