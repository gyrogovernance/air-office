# glib 0.18.5 security backport

This directory contains glib 0.18.5 from crates.io, with its upstream license.
The cached crates.io archive's SHA-256 matched the previous Cargo.lock checksum:
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
`src/variant_iter.rs` applies the two-line upstream fix for
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html):
the C out-pointer is mutable and is passed by mutable reference. The original
fix is [gtk-rs/gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343).

This override is unused by the current Electron desktop host. Keep it only while
a Linux native dependency graph still needs the backport. The unchanged package
version may still be identified as vulnerable by advisory scanners; do not
suppress that advisory without checking this backport and the actual build.
