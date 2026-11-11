# Fixture corpus

Representative inputs for the document worker, with the extraction behavior each one is expected to produce. The worker tests assert these expectations so a regression in normalization, warnings, or refusal is caught.

## Files

| Fixture | Kind | Expected behavior |
| --- | --- | --- |
| `plain-utf8.txt` | text | Text preserved, including non-Latin characters; no warnings. |
| `markdown-complex.md` | markdown | Headings, code fences and lists preserved as text; no warnings. |
| `html-navigation.html` | html | Visible text kept; script, style, nav, header and footer dropped; no warnings. |
| `mixed-direction.txt` | text | Mixed Latin and right-to-left text preserved in order; no warnings. |
| `invalid-encoding.txt` | text | A `corrupt` warning is reported for the replacement characters. |
| `empty.txt` | text | An `empty-content` warning is reported. |
| `unsupported.bin` | unsupported | Reported by the caller as an unsupported kind; the worker refuses the kind. |

## Contracts

- Expected text equality is asserted only where normalization is deliberately stable (paragraph breaks, trailing whitespace runs).
- Unresolved or absent extractor resources produce an explicit warning, never a fabricated extraction.
- A page count is `null` for formats without pages and a one-based integer for paged formats.
