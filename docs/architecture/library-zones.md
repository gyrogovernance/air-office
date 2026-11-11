# Library zones and chat tool safety

## Zones

AIR Office keeps three zones of on-disk data:

1. **Keys** — provider credentials and OAuth material under the private profile (`private/`, including `provider-credentials/`), or the OS keychain / desktop credentials bridge. Chat tools never resolve these paths.
2. **Library** — user content the chat may help with (notes, programs, calendars, automations, connected folders). Mutating tools still use Ask first unless Allow All is selected.
3. **System** — Library paths reserved for the product: `.air/runtime` and `.air/settings`. Chat tools refuse these paths. Agents, skills, prompts, and pack actions under other `.air` folders remain Library content.

Internal code may still use the name `vault` for the Library root on disk. User-facing copy uses **Library**.

## Ask first

Mutate tools (`effect: 'mutate'`) already require per-invocation approval when command permission is `ask`. Allow All skips that gate. `run_code` stays disabled until enabled in Tools settings. Path denial is separate from Ask first: reserved paths fail even when Allow All is on.

## Code workbench

Code may mount an explicitly connected folder. The Library root is not a Code workspace root. `open_in_code` on a Library file opens the file on the stage instead.

### Packaged embedding and trust boundary

On the installed desktop product, the React shell loads from a loopback HTTP server (`http://127.0.0.1`, random port) started by the Electron host. The supervised code-server workbench also binds only to `127.0.0.1` on a random port and starts on demand when Code opens. That pairing keeps the stage iframe and the workbench in the same loopback address space.

Chromium blocks embedding `http://127.0.0.1` from a secure custom-scheme page such as `air-office://`. That failure presents as a blank white Code stage (`chrome-error://`), not as a slow load. Serving the packaged UI on loopback HTTP avoids that block. Development already uses loopback Vite (`http://127.0.0.1:5173`), so packaged behavior matches that shape.

The workbench runs with `auth: none` while bound to loopback. Password cookie handoff into a cross-origin iframe was unreliable under Chromium SameSite and Local Network Access rules. Review disposition for a normal desktop security evaluation:

- Acceptable when documented as loopback-only, on-demand, and inside the same Windows user session trust boundary (common for local desktop helpers).
- Residual risk: any other process in that same user session can reach the workbench port while Code is running.
- Residual risk: browser tabs on the machine may attempt localhost access; modern Chromium continues to tighten Local Network Access for that class of attack.
- Not sufficient for a review that requires authenticated local services or isolation from other local processes. Raising that bar means restoring local auth without putting Code behind a blocked custom-protocol iframe (for example a same-origin proxy or a dedicated BrowserView with an explicit handoff).

Related implementation: `apps/desktop/src/main/ui-server.adapter.ts`, `apps/desktop/src/main/desktop.entry.ts`, `apps/service/src/workbench-process.adapter.ts`, `apps/web/src/app/code-workspace.component.tsx`.

## Starter content

`POST /api/v1/data/starters` with `{ "confirmed": true }` reinstalls shipped agents, skills, and reference documents from the lab pack without clearing user notes or chats.

`DELETE /api/v1/data/workspace` remains the full reset: it clears personal workspace content and then reinstalls starters.

## Related code

- Lean path resolution and denial: `packages/tools/src/lean-file-tools.adapter.ts`
- Chat tool wiring and `open_in_code`: `apps/service/src/application.entry.ts`
- Code folder allow list: `apps/service/src/workbench-file.adapter.ts`
- Settings restore control: `apps/web/src/settings/settings-workspace.component.tsx`
