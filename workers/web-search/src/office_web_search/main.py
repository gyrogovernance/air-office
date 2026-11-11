"""One bounded request per process. Queries and page content travel on stdin."""
import json
import math
import os
import sys
from importlib.metadata import version


def handle(request):
    from ddgs import DDGS
    import certifi

    timeout = max(1, min(120, math.ceil(request.get("timeoutMs", 15000) / 1000)))
    proxy = None
    if request.get("trustProxyEnvironment", True):
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    else:
        for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "DDGS_PROXY"):
            os.environ.pop(name, None)
    verify = certifi.where() if request.get("verifySsl", True) else False
    client = DDGS(proxy=proxy, timeout=timeout, verify=verify)
    # Default to worldwide results; DDGS's own default is US-biased.
    region = request.get("region") or "wt-wt"
    news = request.get("category") == "news"
    search = client.news if news else client.text
    rows = search(
        request["query"],
        max_results=max(1, min(10, request.get("limit", 5))),
        backend="auto",
        **({"timelimit": "d"} if news else {}),
        region=region if isinstance(region, str) else "wt-wt",
    )
    return {"results": [
        {"title": row.get("title", ""), "url": row.get("url" if news else "href", ""), "snippet": row.get("body", "")}
        for row in rows
    ]}


def main():
    if "--probe" in sys.argv:
        print(json.dumps({"protocol": 1, "engine": "ddgs", "version": version("ddgs")}))
        return
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ValueError("Request is too large")
        result = handle(json.loads(raw))
        print(json.dumps({"ok": True, **result}, ensure_ascii=True))
    except Exception:
        # Upstream errors may contain proxy credentials or full request URLs.
        print(json.dumps({"ok": False, "error": "Web search could not complete. Try again shortly."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
