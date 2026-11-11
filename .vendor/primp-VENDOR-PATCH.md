# Primp certificate trust patch

Source: PyPI primp 2.0.1 source distribution, https://pypi.org/project/primp/2.0.1/.
Original source archive SHA-256: `82ba17b077bef19a189d9ec8d77ca632496cb444e0f4fa37e27e90041cf0da8f`.
License: MIT, retained in the source archive.

The local version is 2.0.1+air.1. In `crates/primp-python/src/client_builder.rs`, supplying `ca_cert_file` now calls the library's `tls_certs_only(ca_certs)` instead of adding each certificate to its built-in and native roots. No other HTTP behavior changes.

DDGS passes this option when `verify` is a PEM path. AIR supplies Certifi 2026.10.19. The upstream implementation merges the provided bundle with old roots and accepted both eMudhra test endpoints even with updated Certifi.

Archive: `primp-2.0.1-air.1.tar.gz`.
SHA-256: `aa9e7b95bb4d9d53dbed75272deef2692ff494adb2be04c4f229f2e5b2086940`.

Build with `bun run tools/prepare-web-search.entry.ts`. The preparer builds a host wheel from this source and caches it by source SHA-256, operating system and architecture before installing the requirements. The source build requires Rust and its native build dependencies on the packaging host. Installed AIR Office users receive the frozen worker and do not need build tools.
