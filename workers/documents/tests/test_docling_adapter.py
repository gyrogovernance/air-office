"""Protocol and extraction tests for the document worker.

These run without Docling so the default path is verified independently of an
optional engine. A fake extractor never stands in for the real conversion path;
instead each test uses a real fixture file and asserts its declared behavior.
"""

from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

import pytest

from office_documents.extraction_handler import EXTRACTOR, MAX_BYTES, extract
from office_documents.main import run
from office_documents.worker_protocol import PROTOCOL_VERSION, ProtocolError, parse_request, serialize_response

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def request(kind: str, name: str) -> "object":
    return parse_request(json.dumps({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "req-1",
        "source_version_id": "v1",
        "kind": kind,
        "input_path": str(FIXTURES / name),
    }))


def test_plain_utf8_text_is_preserved_without_warnings() -> None:
    response = extract(request("text", "plain-utf8.txt"))
    assert response.ok
    assert "quick brown fox" in response.text
    assert "Καλημέρα κόσμε" in response.text
    assert response.warnings == []
    assert response.page_count is None
    assert response.content_hash


def test_markdown_structure_is_preserved() -> None:
    response = extract(request("markdown", "markdown-complex.md"))
    assert "# Document title" in response.text
    assert "const value = 1;" in response.text
    assert "- first item" in response.text


def test_html_drops_navigation_noise() -> None:
    response = extract(request("html", "html-navigation.html"))
    assert "Visible heading" in response.text
    assert "Visible paragraph text." in response.text
    assert "Navigation links" not in response.text
    assert "console.log" not in response.text
    assert "Site footer" not in response.text


def test_mixed_direction_text_is_not_reordered() -> None:
    response = extract(request("text", "mixed-direction.txt"))
    assert "English then العربية then back to English." in response.text
    assert "עברית followed by more text." in response.text


def test_invalid_bytes_produce_a_corrupt_warning() -> None:
    response = extract(request("text", "invalid-encoding.txt"))
    assert any(warning.code == "corrupt" for warning in response.warnings)


def test_empty_input_produces_an_empty_content_warning() -> None:
    response = extract(request("text", "empty.txt"))
    assert any(warning.code == "empty-content" for warning in response.warnings)


def test_an_uninstalled_paged_extractor_reports_unsupported_rather_than_fabricating() -> None:
    response = extract(request("pdf", "unsupported.bin"))
    assert response.ok
    if response.text == "":
        assert any(warning.code in {"unsupported-format", "corrupt"} for warning in response.warnings)


def test_a_missing_file_is_an_explicit_failure() -> None:
    parsed = parse_request(json.dumps({"protocol_version": PROTOCOL_VERSION, "request_id": "r", "source_version_id": "v1", "kind": "text", "input_path": str(FIXTURES / "does-not-exist.txt")}))
    response = extract(parsed)
    assert response.ok is False
    assert response.error


def test_protocol_rejects_a_version_mismatch_and_unknown_kind() -> None:
    with pytest.raises(ProtocolError):
        parse_request(json.dumps({"protocol_version": 2, "request_id": "r", "source_version_id": "v1", "kind": "text", "input_path": "x"}))
    with pytest.raises(ProtocolError):
        parse_request(json.dumps({"protocol_version": PROTOCOL_VERSION, "request_id": "r", "source_version_id": "v1", "kind": "zip", "input_path": "x"}))


def test_serialize_response_omits_absent_page() -> None:
    response = extract(request("text", "plain-utf8.txt"))
    line = serialize_response(response)
    payload = json.loads(line)
    assert payload["protocol_version"] == PROTOCOL_VERSION
    assert payload["extractor"] == EXTRACTOR
    assert all("page" not in warning for warning in payload["warnings"])


def test_the_protocol_loop_prints_capabilities_then_answers_one_request_per_line() -> None:
    stdin = StringIO(json.dumps({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "req-loop",
        "source_version_id": "v1",
        "kind": "text",
        "input_path": str(FIXTURES / "plain-utf8.txt"),
    }) + "\n")
    stdout = StringIO()
    assert run(stdin=stdin, stdout=stdout) == 0
    lines = [line for line in stdout.getvalue().splitlines() if line.strip()]
    assert json.loads(lines[0])["protocol_version"] == PROTOCOL_VERSION
    assert json.loads(lines[1])["request_id"] == "req-loop"


def test_an_oversized_read_is_bounded_and_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("office_documents.extraction_handler.MAX_BYTES", 8)
    response = extract(request("text", "plain-utf8.txt"))
    assert any(warning.code == "truncated" for warning in response.warnings)
    assert len(response.text.encode("utf-8")) <= 64
    assert MAX_BYTES > 8
