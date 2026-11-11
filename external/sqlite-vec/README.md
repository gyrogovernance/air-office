# sqlite-vec (`vec0`)

`vec0` is a small SQLite extension that stores and searches vector embeddings (the numbers produced from text by a local embedding model). AIR Office uses it for knowledge search in the workspace database.

| File | Platform |
| --- | --- |
| `vec0.dll` | Windows x64 |
| `vec0.dylib` | macOS universal (`x86_64` + `arm64`) |
| `vec0.so` | Linux (when packaged) |

## Current macOS universal binary

| Field | Value |
| --- | --- |
| File | `vec0.dylib` |
| Arch | universal: `x86_64` + `arm64` |
| Upstream | [asg017/sqlite-vec v0.1.9](https://github.com/asg017/sqlite-vec/releases/tag/v0.1.9) loadable `macos-x86_64` + `macos-aarch64`, joined with `lipo -create` |
| Slice SHA-256 (x86_64) | `d39d33d16d302d57440d9a9cdbe3cc095e8324aa96b979b5171f545a6346996d` |
| Slice SHA-256 (arm64) | `193e480c50b59a55977d166f4aaf0e1bc8832d6963516e5950f39e4d2ce0b793` |
| Fat file SHA-256 | `344c826bb7ec954653a869be4a6d9ebf4af858afdcfaf15ae8cb2ce115091811` |
