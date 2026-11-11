# Vendored Liquid Glass package

AIR Office installs `@glass-sdk/liquid-glass` version `0.0.2` from `liquid-glass-0.0.2.tgz`. The archive preserves the locally patched package previously installed from `.vendor/liquid-glass`, including its compiled JavaScript, CSS, declarations, README and MIT license. The upstream source reference is `.dev/references/liquid-glass/packages/liquid-glass`; that checkout does not contain the complete local patch set.

The preserved patches cover exact circular cap geometry, even rim lighting, tint alpha and gradient tints. Their original implementation notes are reproduced below. The package version remains the upstream release version; the repository-local archive identifies the patched distribution.

The archive was created from the existing installed package with `bun pm pack --ignore-scripts`, which preserves the compiled output without rebuilding it. Keep this archive and the patch record in version control so `bun install --frozen-lockfile` works from a clean checkout. Future refreshes require comparison of the local patches and verification of the resulting glass rendering.

## Preserved local patch notes

### Circular cap geometry (`src/core/shape.ts`)

`shapePath` and `shapeClip` emit an exact inscribed ellipse for `radius === "circle"` instead of delegating to `@lisse/core` path generation. The upstream curve calculation leaves a shoulder inside the left and right bounds, making a square button read as an oval. Two half arcs at the true half-width and half-height remove the shoulder.

The ellipse output is consumed by `shapePolygon`, whose arc parser requires equal radii, rotation `0`, large-arc `0`, and sweep `1`. The emitted arc commands retain that form for GPU tessellation.

### Even rim lighting (`src/gpu/maps.wgsl`)

The overlay plane keeps a mid-tone base rim on every edge, softens the directional highlight and side shade, and blends the overlay color between that rim and a softer peak. Circular controls retain visible edges against both light and dark backgrounds.

### Tint alpha and gradient tints (`src/dom/material-graph.ts`, `src/dom/index.ts`, `src/dom/lens-layers.ts`)

Tint parsing accepts `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`, plus solid-stop diagonal gradients such as `linear-gradient(135deg, #243447, #6d849c)`. The eighth hex digit controls tint strength through a bounded arithmetic `feComposite` pass, while overlay tint leaves more rim light neutral.

Gradient tints are encoded once per distinct string as a 128px PNG and interned as `feImage` map tokens. Gradient stops use solid hex colors; stop alpha is ignored to avoid composing transparency twice. Both renderers share `tintPasses` and `tintOutputCount`, while tint strings remain opaque identities in branch keys and grouping tests.

### Interface CSS zoom (`src/dom/page-zoom.ts`)

Upstream `pageZoom()` only measures WebKit browser zoom through `devicePixelRatio` and the `resolution` media feature, and returns `1` on Chromium and Firefox. AIR Office scales the whole UI with `html { zoom: var(--interface-scale) }`.

On WebKit, CSS zoom compounds with browser zoom the same way as layout-vs-filter mismatch, so the patch multiplies `--interface-scale` (falling back to computed `zoom`) into the measured browser-zoom factor and caches that CSS factor so scale changes rebuild filters.

On Chromium and Firefox, `getBoundingClientRect` already returns boxes after CSS zoom, so multiplying filter markup again shrinks the optical rim inside the capsule. Those engines keep `pageZoom() === 1`. The scene compose loop still includes `--interface-scale` in its dirty key (`dist/dom.js`) so every live scene rebuilds lenses when interface size changes, and AIR Office also remounts shell/stage scenes and nested workspace chrome. Mirror `dist/dom/page-zoom.js` and `dist/dom.js` when refreshing the archive.
