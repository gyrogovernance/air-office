"""Corpus-driven extraction tests.

Every fixture ships in corpus.json with its content hash and expected behavior.
Text-like fixtures, including text-layer PDFs, are asserted against their
declared phrases, warnings, and page counts over whitespace-normalized text.
Engine fixtures (scanned PDF, DOCX, image) assert their full quality
expectations when the optional engine is installed, and a controlled refusal
otherwise; the refusal branch is also exercised with the engine present by
forcing the adapter to report it as unavailable, so both branches stay covered
on every machine.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from office_documents import extraction_handler
from office_documents.docling_adapter import docling_available
from office_documents.extraction_handler import extract
from office_documents.worker_protocol import ProtocolError, PROTOCOL_VERSION, parse_request

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
CORPUS = json.loads((FIXTURES / "corpus.json").read_text(encoding="utf-8"))
ENTRIES = {entry["file"]: entry for entry in CORPUS["fixtures"]}


def request(kind: str, name: str) -> object:
    return parse_request(json.dumps({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": f"corpus-{name}",
        "source_version_id": f"v-{name}",
        "kind": kind,
        "input_path": str(FIXTURES / name),
    }))


def engine_entries() -> list[dict]:
    return [entry for entry in CORPUS["fixtures"] if entry.get("requires_engine")]


def plain_entries() -> list[dict]:
    return [entry for entry in CORPUS["fixtures"] if not entry.get("requires_engine") and "worker_kind" not in entry]


def test_every_declared_fixture_exists_with_its_recorded_hash() -> None:
    assert CORPUS["schema_version"] == 1
    assert len(CORPUS["fixtures"]) >= 20
    for name, entry in ENTRIES.items():
        data = (FIXTURES / name).read_bytes()
        assert len(data) == entry["bytes"], name
        assert hashlib.sha256(data).hexdigest() == entry["sha256"], name


def test_duplicate_and_revision_relationships_are_reflected_in_hashes() -> None:
    assert ENTRIES["duplicate-plain.txt"]["sha256"] == ENTRIES["plain-utf8.txt"]["sha256"]
    assert ENTRIES["revision-v1.md"]["sha256"] != ENTRIES["revision-v2.md"]["sha256"]
    assert (FIXTURES / "duplicate-plain.txt").read_bytes() == (FIXTURES / "plain-utf8.txt").read_bytes()


def test_protocol_refuses_declared_unsupported_kinds() -> None:
    for entry in CORPUS["fixtures"]:
        if entry.get("worker_kind") != "unsupported":
            continue
        assert (FIXTURES / entry["file"]).exists(), entry["file"]
        with pytest.raises(ProtocolError):
            parse_request(json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "request_id": "refuse",
                "source_version_id": "v1",
                "kind": "unsupported",
                "input_path": str(FIXTURES / entry["file"]),
            }))


def test_text_like_fixtures_meet_declared_expectations() -> None:
    for entry in plain_entries():
        name = entry["file"]
        response = extract(request(entry["kind"], name))
        assert response.ok, name
        # Text-layer PDFs report embedded lines with hard breaks, so phrases are
        # matched against whitespace-normalized text like the engine branch.
        normalized = " ".join(response.text.split())
        for phrase in entry.get("contains", []):
            assert phrase in normalized, f"{name}: missing {phrase!r}"
        for phrase in entry.get("not_contains", []):
            assert phrase not in response.text, f"{name}: unexpected {phrase!r}"
        observed = [warning.code for warning in response.warnings]
        assert observed == entry.get("warnings", []), name
        assert response.page_count is entry.get("page_count"), name


def test_engine_fixtures_refuse_without_the_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """The refusal branch stays covered even on a machine that has the engine."""
    monkeypatch.setattr(extraction_handler, "docling_available", lambda: False)
    for entry in engine_entries():
        response = extract(request(entry["kind"], entry["file"]))
        assert response.ok, entry["file"]
        assert response.text == "", entry["file"]
        assert any(warning.code == "unsupported-format" for warning in response.warnings), entry["file"]


@pytest.mark.skipif(not docling_available(), reason="the optional extraction engine is not installed")
def test_engine_fixtures_meet_quality_expectations() -> None:
    for entry in engine_entries():
        name = entry["file"]
        response = extract(request(entry["kind"], name))
        assert response.ok, name
        # The engine emits paragraphs for each source line, so phrases are
        # matched against whitespace-normalized text rather than raw output.
        normalized = " ".join(response.text.split())
        observed = {warning.code for warning in response.warnings}
        if entry.get("ocr_sample"):
            hit = any(phrase in normalized for phrase in entry.get("contains", []))
            allowed = set(entry.get("warnings_any", []))
            assert hit or observed & allowed, f"{name}: neither OCR text nor a declared warning; got {sorted(observed)}"
        elif "warnings_any" in entry:
            assert observed & set(entry["warnings_any"]), f"{name}: expected one of {entry['warnings_any']}, got {sorted(observed)}"
        else:
            for phrase in entry.get("contains", []):
                assert phrase in normalized, f"{name}: missing {phrase!r}"
            assert observed == set(entry.get("warnings", [])), f"{name}: {sorted(observed)}"
        if entry.get("page_count") is not None and not entry.get("ocr_sample"):
            assert response.page_count == entry["page_count"], f"{name}: pages {response.page_count}"


def test_an_oversized_input_is_truncated_and_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from office_documents.extraction_handler import MAX_BYTES

    oversized = tmp_path / "oversized.txt"
    oversized.write_bytes(b"A" * (MAX_BYTES + 4096))
    monkeypatch.setattr("office_documents.extraction_handler.MAX_BYTES", 1024)
    response = extract(parse_request(json.dumps({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "oversized",
        "source_version_id": "v1",
        "kind": "text",
        "input_path": str(oversized),
    })))
    assert response.ok
    assert any(warning.code == "truncated" for warning in response.warnings)
    assert len(response.text) <= 1024
    assert MAX_BYTES >= 1024
