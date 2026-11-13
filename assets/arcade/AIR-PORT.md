# AIR Office Arcade

Vendored from https://github.com/KilledByAPixel/LittleJSArcade at commit
`c14102b706a5f1bbedbbe5087706d6425660300c` on 19 October 2026.

The launcher, games, templates, engine distributions and images are bundled
as static assets for offline play. The LittleJS engine builds live in
`assets/arcade/dist/` (tracked explicitly; the repo-wide `**/dist/` ignore does
not apply there). AIR Office mounts the launcher in an iframe inside its
existing stage. Switching away unmounts the console and stops its
games and audio; scores and preferences retain upstream localStorage behavior.
An unfinished round is not saved by AIR Office.

Upstream changes: an attribution paragraph in the launcher's About dialog;
engineLoader.js loads the identical engine settings from air-engine-settings.js
instead of generating an inline script, so desktop CSP can authorize it.
AIR Office uses its paper stage background and appearance, Fluent Video game
emoji for the app icon and launcher logo, and a bottom source credit. The
air-arcade.css overrides remove upstream brand effects and duplicate theme,
sharing and fullscreen controls. Standard game HUD fullscreen is disabled in
menus.js; standalone fullscreen entries are removed from Geometry Jump, Slot
Demon and Music Sequencer. Game rules and artwork are otherwise unchanged.
Keep relative paths intact when updating.

The console copies AIR's stage fill and paper variables into its own document
so it does not depend on browser iframe transparency. The library side panel
stays hidden when a game opens. An AIR GlassToolbar below the stage title bar
offers Games, sound and the upstream game's toolbar actions. It forwards clicks
to the game's actual buttons and mirrors their labels/disabled state; native
game toolbars are hidden. Existing game menus and rules remain upstream.
Desktop CSP permits same-origin WebAssembly loading for Box2D games, without
enabling arbitrary JavaScript eval.
No runtime CDN is required. The optional upstream external-games section is
disabled by upstream's SHOW_FRANKFORCE=false. Source/credit links remain external.

Code and engine: MIT, see LICENSE. The bundled Twemoji font is CC-BY-4.0,
copyright Twitter, Inc and contributors; see games/TWEMOJI-LICENSE.txt.
Game emoji retain the upstream font. The app icon and main logo use Microsoft's
Fluent Emoji Video game 3D PNG, MIT licensed. Source and license are exposed in
Settings References and THIRD-PARTY-NOTICES.md. No game artwork conversion was added.
