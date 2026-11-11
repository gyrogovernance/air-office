"""Versioned worker protocol.

The worker speaks one JSON object per line over stdin and stdout. It never opens
the application database and never decides source identity; it receives a path to
a bounded scratch copy and returns a normalized artifact or an explicit error. A
protocol version mismatch is rejected before any extraction runs, so an old
worker cannot silently accept a new payload and guess its fields.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_VERSION = 1

#: Kinds the worker understands. An unknown kind is refused, not guessed.
SUPPORTED_KINDS = {"text", "markdown", "html", "pdf", "docx", "image"}


class ProtocolError(Exception):
    """Raised when an incoming request is malformed or unsupported."""


@dataclass
class ExtractionRequest:
    request_id: str
    source_version_id: str
    kind: str
    input_path: str


@dataclass
class Warning:
    code: str
    message: str
    page: int | None = None


@dataclass
class ExtractionResponse:
    request_id: str
    extractor: str
    extractor_version: str
    extraction_version: str
    text: str
    page_count: int | None
    pages: list[dict[str, object]] = field(default_factory=list)
    warnings: list[Warning] = field(default_factory=list)
    content_hash: str = ""
    ok: bool = True
    error: str | None = None


def parse_request(line: str) -> ExtractionRequest:
    """Parses one protocol line into a request, rejecting anything malformed."""
    try:
        payload: Any = json.loads(line)
    except json.JSONDecodeError as error:
        raise ProtocolError("Request is not valid JSON.") from error
    if not isinstance(payload, dict):
        raise ProtocolError("Request must be a JSON object.")
    if payload.get("protocol_version") != PROTOCOL_VERSION:
        raise ProtocolError("Worker protocol version mismatch.")
    request_id = payload.get("request_id")
    source_version_id = payload.get("source_version_id")
    kind = payload.get("kind")
    input_path = payload.get("input_path")
    if not isinstance(request_id, str) or not request_id:
        raise ProtocolError("request_id is required.")
    if not isinstance(source_version_id, str) or not source_version_id:
        raise ProtocolError("source_version_id is required.")
    if not isinstance(kind, str) or kind not in SUPPORTED_KINDS:
        raise ProtocolError("kind is not supported.")
    if not isinstance(input_path, str) or not input_path:
        raise ProtocolError("input_path is required.")
    return ExtractionRequest(request_id=request_id, source_version_id=source_version_id, kind=kind, input_path=input_path)


def serialize_response(response: ExtractionResponse) -> str:
    """Serializes a response as one compact JSON line."""
    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": response.request_id,
        "ok": response.ok,
        "extractor": response.extractor,
        "extractor_version": response.extractor_version,
        "extraction_version": response.extraction_version,
        "text": response.text,
        "page_count": response.page_count,
        "pages": [
            {"page": int(page["page"]), "text": str(page["text"])}
            for page in response.pages
            if isinstance(page.get("page"), int) and isinstance(page.get("text"), str)
        ],
        "warnings": [
            {"code": warning.code, "message": warning.message, **({"page": warning.page} if warning.page is not None else {})}
            for warning in response.warnings
        ],
        "content_hash": response.content_hash,
        "error": response.error,
    }
    return json.dumps(payload, separators=(",", ":"))
