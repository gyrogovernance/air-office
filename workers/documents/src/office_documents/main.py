"""Worker entrypoint.

Reads one JSON request per line from stdin and writes one JSON response per line
to stdout. It deliberately owns no durability and no database handle: the service
decides source identity and stores artifacts, so a worker crash cannot corrupt
document state. Cancellation is cooperative: the service stops writing and closes
the worker, and a closed stdin ends the loop cleanly.
"""

from __future__ import annotations

import sys

from .extraction_handler import EXTRACTOR, EXTRACTOR_VERSION, EXTRACTION_VERSION, extract
from .worker_protocol import PROTOCOL_VERSION, ProtocolError, parse_request, serialize_response


def _capabilities_line() -> str:
    """One line describing the worker, printed on startup so the service can verify the protocol before sending work."""
    import json

    return json.dumps({
        "protocol_version": PROTOCOL_VERSION,
        "extractor": EXTRACTOR,
        "extractor_version": EXTRACTOR_VERSION,
        "extraction_version": EXTRACTION_VERSION,
    }, separators=(",", ":"))


def run(stdin=None, stdout=None) -> int:
    """Runs the protocol loop. Returns a process exit code."""
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    stdout.write(_capabilities_line() + "\n")
    stdout.flush()
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = parse_request(line)
        except ProtocolError as error:
            import json

            stdout.write(json.dumps({"protocol_version": PROTOCOL_VERSION, "ok": False, "error": str(error)}, separators=(",", ":")) + "\n")
            stdout.flush()
            continue
        response = extract(request)
        stdout.write(serialize_response(response) + "\n")
        stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
