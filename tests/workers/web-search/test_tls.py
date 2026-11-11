import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

import certifi

spec = importlib.util.spec_from_file_location(
    "office_web_search", Path(__file__).resolve().parents[3] / "workers/web-search/src/office_web_search/main.py"
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SearchTlsTest(unittest.TestCase):
    def test_search_uses_patched_bundle_and_preserves_explicit_opt_out(self):
        with patch("ddgs.DDGS") as client:
            client.return_value.text.return_value = []
            worker.handle({"query": "fixture"})
            self.assertEqual(client.call_args.kwargs["verify"], certifi.where())
            worker.handle({"query": "fixture", "verifySsl": False})
            self.assertIs(client.call_args.kwargs["verify"], False)


if __name__ == "__main__":
    unittest.main()
