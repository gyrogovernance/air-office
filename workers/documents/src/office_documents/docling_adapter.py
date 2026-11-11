"""Optional Docling adapter.

Docling is a candidate engine for PDF, DOCX and image input. It is loaded lazily
so the worker runs without it; when absent the caller reports an explicit
unsupported-format warning instead of a fabricated extraction. The adapter never
touches the application database. It returns normalized text, page count, optional
per-page text derived from Docling provenance, and warnings.

Page text is grouped by ``ProvenanceItem.page_no`` so AIR page anchors can resolve
against the stored extraction of a preserved original. Docling bounding boxes and
character spans are not remapped into original-geometry coordinates here.
"""

from __future__ import annotations

from collections import defaultdict

from .worker_protocol import Warning

DOCLING_VERSION = "pinned-at-package-time"


def docling_available() -> bool:
    """True when the Docling engine can be imported in this environment."""
    try:
        import docling  # noqa: F401
    except Exception:
        return False
    return True


def _normalize_page_text(text: str) -> str:
    return " ".join(text.replace("\r\n", "\n").replace("\r", "\n").split()).strip()


def _pages_from_docling(document: object) -> list[dict[str, object]]:
    """Collects one-based page texts from item provenance when available."""
    by_page: dict[int, list[str]] = defaultdict(list)
    iterate = getattr(document, "iterate_items", None)
    if not callable(iterate):
        return []
    try:
        items = iterate()
    except TypeError:
        items = iterate(with_groups=False)
    except Exception:
        return []
    for entry in items:
        item = entry[0] if isinstance(entry, tuple) and entry else entry
        raw = getattr(item, "text", None)
        if not isinstance(raw, str) or not raw.strip():
            continue
        prov = getattr(item, "prov", None) or []
        entries = prov if isinstance(prov, list) else [prov]
        page_nos: list[int] = []
        for pointer in entries:
            page_no = getattr(pointer, "page_no", None)
            if isinstance(page_no, int) and page_no >= 1:
                page_nos.append(page_no)
        if not page_nos:
            continue
        by_page[page_nos[0]].append(_normalize_page_text(raw))
    return [{"page": page, "text": "\n".join(parts).strip()} for page, parts in sorted(by_page.items()) if "\n".join(parts).strip()]


def extract_with_docling(kind: str, input_path: str) -> tuple[str, int | None, list[dict[str, object]], list[Warning]]:
    """Extracts text through Docling, reporting engine failures as warnings.

    The signature is stable whether or not Docling is installed so callers keep a
    single path. A failure to convert becomes a ``corrupt`` warning with empty
    text rather than an exception that would look like a worker crash.
    """
    try:
        from docling.datamodel.base_models import InputFormat  # type: ignore
        from docling.datamodel.pipeline_options import PdfPipelineOptions  # type: ignore
        from docling.document_converter import DocumentConverter, PdfFormatOption  # type: ignore
    except Exception:
        return "", None, [], [Warning(code="unsupported-format", message=f"The {kind} extractor resource is not installed.")]
    try:
        # Table structure recognition runs a detection model whose CPU inference
        # varies between runs, and a bad grid match drops page text such as the
        # heading above a table. Cells stay in the output as ordered text, so
        # disabling it trades markdown table layout for deterministic extraction.
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_table_structure = False
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)})
        result = converter.convert(input_path)
        pages = _pages_from_docling(result.document)
        page_count = len(getattr(result.document, "pages", {}) or {}) or (pages[-1]["page"] if pages else None)
        if isinstance(page_count, int) and page_count < 1:
            page_count = None
        if pages:
            text = "\n\n".join(str(page["text"]) for page in pages)
        else:
            text = result.document.export_to_markdown()
        warnings: list[Warning] = []
        if kind == "image":
            warnings.append(Warning(code="ocr-low-confidence", message="Image text was read by OCR and should be reviewed."))
        return text, page_count if isinstance(page_count, int) else None, pages, warnings
    except Exception as error:  # noqa: BLE001 - engine errors become explicit warnings
        return "", None, [], [Warning(code="corrupt", message=f"Docling could not convert the input: {type(error).__name__}.")]
