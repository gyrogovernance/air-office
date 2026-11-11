"""Text extraction handler.

The handler reads a bounded scratch copy, normalizes it, and returns an artifact.
Plain text, Markdown and HTML are extracted without external dependencies so the
default path always works. PDF, DOCX and image kinds delegate to the Docling
adapter when it is installed and otherwise return an explicit unsupported or
resource warning rather than a fabricated result.
"""

from __future__ import annotations

import hashlib
import html.parser
import re
from pathlib import Path

from .docling_adapter import extract_with_docling, docling_available
from .worker_protocol import ExtractionRequest, ExtractionResponse, Warning

EXTRACTOR = "office-documents"
EXTRACTOR_VERSION = "1"
EXTRACTION_VERSION = "anchor-v1"

#: Bounded read so an oversized file cannot exhaust worker memory.
MAX_BYTES = 20 * 1024 * 1024


class _HtmlTextExtractor(html.parser.HTMLParser):
    """Collects visible text and drops navigation noise (script, style, nav)."""

    _noise = {"script", "style", "noscript", "nav", "header", "footer"}

    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._suppress = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._noise:
            self._suppress += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self._noise and self._suppress:
            self._suppress -= 1
        if tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._suppress:
            self._chunks.append(data)

    def text(self) -> str:
        return "".join(self._chunks)


def _normalize(text: str) -> str:
    """Collapses runs of blank lines but keeps paragraph breaks and code fences."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _extract_pdf_text_layer(path: str) -> tuple[str, int | None, list[dict[str, object]]] | None:
    """Extracts embedded PDF text deterministically, or returns None.

    Text-layer extraction uses the PDF backend directly so files with a usable
    text layer produce byte-stable output; the Docling engine then only runs for
    content that has no text layer, such as scanned pages. Any failure or a page
    set without text hands the file to the engine path unchanged. Per-page text is
    retained so AIR page anchors can resolve against the stored extraction.
    """
    try:
        import pypdfium2 as pdfium  # noqa: PLC0415 - optional backend dependency
    except Exception:
        return None
    try:
        document = pdfium.PdfDocument(path)
        pages: list[str] = []
        for index in range(len(document)):
            pages.append(document[index].get_textpage().get_text_range())
        document.close()
    except Exception:
        return None
    page_entries = [{"page": index + 1, "text": page.strip()} for index, page in enumerate(pages)]
    text = _normalize("\n\n".join(str(entry["text"]) for entry in page_entries if str(entry["text"]).strip()))
    if text == "":
        return None
    return text, len(pages), page_entries


def _read_bounded(path: str) -> tuple[bytes, bool]:
    """Returns the bytes and whether the file was truncated at the size bound."""
    file_path = Path(path)
    size = file_path.stat().st_size
    with file_path.open("rb") as handle:
        data = handle.read(MAX_BYTES)
    return data, size > MAX_BYTES


def extract(request: ExtractionRequest) -> ExtractionResponse:
    """Extracts one source into a normalized artifact.

    Never raises for expected conditions: encrypted, corrupt and unsupported
    inputs become explicit warnings and an empty text so the caller can surface
    them rather than treating a failure as success.
    """
    warnings: list[Warning] = []
    try:
        data, truncated = _read_bounded(request.input_path)
    except OSError as error:
        return ExtractionResponse(
            request_id=request.request_id, extractor=EXTRACTOR, extractor_version=EXTRACTOR_VERSION,
            extraction_version=EXTRACTION_VERSION, text="", page_count=None, warnings=[],
            content_hash="", ok=False, error=f"Input could not be read: {error.strerror or 'unknown error'}",
        )

    if truncated:
        warnings.append(Warning(code="truncated", message=f"Input exceeded {MAX_BYTES} bytes and was truncated."))

    content_hash = _hash_bytes(data)
    page_count: int | None = None
    pages: list[dict[str, object]] = []

    if request.kind in {"pdf", "docx", "image"}:
        text = ""
        page_count = None
        if request.kind == "pdf":
            layer = _extract_pdf_text_layer(request.input_path)
            if layer is not None:
                text, page_count, pages = layer
        if text == "":
            if docling_available():
                text, page_count, pages, docling_warnings = extract_with_docling(request.kind, request.input_path)
                warnings.extend(docling_warnings)
            else:
                warnings.append(Warning(code="unsupported-format", message=f"The {request.kind} extractor resource is not installed."))
        text = _normalize(text)
    else:
        decoded = data.decode("utf-8", errors="replace")
        if "\ufffd" in decoded:
            warnings.append(Warning(code="corrupt", message="Input contained bytes that are not valid UTF-8."))
        if request.kind == "html":
            parser = _HtmlTextExtractor()
            parser.feed(decoded)
            text = _normalize(parser.text())
        else:
            text = _normalize(decoded)

    if text.strip() == "":
        warnings.append(Warning(code="empty-content", message="No extractable text was found."))

    return ExtractionResponse(
        request_id=request.request_id, extractor=EXTRACTOR, extractor_version=EXTRACTOR_VERSION,
        extraction_version=EXTRACTION_VERSION, text=text, page_count=page_count, pages=pages,
        warnings=warnings, content_hash=content_hash, ok=True,
    )


__all__ = ["extract", "EXTRACTOR", "EXTRACTOR_VERSION", "EXTRACTION_VERSION", "MAX_BYTES"]
