# Floor Map Builder

**Status**: Implemented
**Last Updated**: 2026-09-26

## Overview

Admin › Maps › *map* is where an organizer draws an event's floor: booths and tables to sell, landmarks (stage, entrances, restrooms, food, info desk, first aid, activity area), text labels and walls. It is built for people who have never used a drawing tool: click a tile to add something, drag it where it belongs, and everything saves itself. Selling, assigning vendors and publishing are covered in [floor-maps.md](floor-maps.md).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/admin/maps/[mapId]/page.tsx` | Builder page: header (save state, undo/redo, zoom, help, publish), add/turn/copy/delete/nudge operations, keyboard shortcuts, publish + shortcuts dialogs, screen-reader announcements |
| `frontend/src/components/maps/useMapEditor.ts` | Layout + settings state, `commit` / `checkpoint` undo model, debounced autosave, server-id adoption after save, `refreshBooths` |
| `frontend/src/components/maps/builder/EditorCanvas.tsx` | Canvas with its own viewport (fit, zoom at cursor, pan), drag-to-move, corner resize, Shift-drag box select, palette drop target with ghost preview, floating Turn / Copy / Delete bar |
| `frontend/src/components/maps/builder/AddPalette.tsx` | "Add to map" tiles: click adds in the middle of the view, drag drops at the pointer |
| `frontend/src/components/maps/builder/InspectorPanel.tsx` | Right panel: floor settings + getting-started checklist + colors (nothing selected), booth / landmark / multi-select properties, vendor `BoothPanel` |
| `frontend/src/components/maps/builder/BoothBlockDialog.tsx` | "Rows of booths": rows × booths per row, size, gap, walkway, letter + start number, live preview, fit and label-clash checks |
| `frontend/src/components/maps/builder/BuilderDialog.tsx` | Modal used by the builder (focus trap, Escape, focus return) + shared button/field classes |
| `frontend/src/components/maps/builder/catalog.ts` | What can be added: names, hints, default sizes per unit, `dragState` |
| `frontend/src/components/maps/builder/placement.ts` | Pure geometry: footprints, free-spot search, clamping, next label, booth blocks, occupied extent |
| `frontend/src/components/maps/MapElement.tsx` | Shared element renderer (builder + public map): lucide icons, every element drawn inside its own box |
| `frontend/src/components/maps/Booth.tsx` | Shared booth renderer; label colour follows the tier swatch (`bestForeground`) for contrast |
| `frontend/tests/unit/mapPlacement.test.ts` | Vitest for `placement.ts` / `defaultSize` |
| `frontend/e2e/admin-maps.spec.ts` | Palette click + drag, rows dialog, mouse drag + resize, arrow-key nudge + undo, booth assignment panel |

## Configuration

None. The builder uses the existing `/admin/maps/*` API.

## How It Works

1. **Adding.** Every palette tile works two ways. Click (or Enter) places the item at the centre of the visible floor; dragging it (HTML5 drag and drop) places it under the pointer, with a dashed ghost while hovering. `findFreeSpot` moves it to the nearest spot that does not overlap another booth or landmark, so nothing lands on top of something else. The new item is selected, briefly outlined, scrolled into view and announced. Booths get the next free number with the previous booth's prefix (`nextBoothLabel`); if the event has exactly one price tier it is assigned automatically. "Rows of booths" opens `BoothBlockDialog`; its default letter is the first one not already used.
2. **Editing on the canvas.** Pointer down on an item selects it (Shift / Ctrl / ⌘ toggles) and dragging moves the whole selection in whole units, stopped at the floor edge (`clampGroupDelta`). The square handle at the bottom-right corner resizes (walls stretch along their own direction only). Dragging empty space pans, Shift-dragging empty space box-selects, the wheel or a trackpad pinch zooms around the pointer, Space-drag pans from anywhere. A floating bar above the selection offers Turn, Copy and Delete.
3. **Editing in the panel.** Nothing selected: map name, floor width/depth (cannot shrink past what is on it), feet/meters, a four-step getting-started list, and the tier colours. One booth: number (unique, validated inline), booth/table, size, price tier, Turn/Copy/Delete, then the vendor panel (assign, move, reserve, block). Several selected: set the price tier or type for all booths at once. Text and number fields commit on blur or Enter so one edit is one undo step.
4. **Turn** swaps width and depth around the centre (walls switch horizontal/vertical). Legacy `rotation: 90` booths are turned back to `rotation: 0`; the builder never creates new rotated booths.
5. **Saving.** Every change bumps a revision; 1.2 s later `save()` PATCHes the settings and PUTs the whole layout, reading the *latest* state through a ref. Edits made during a save trigger another save when it finishes. The header shows "All changes saved" / "Saving…" / "Unsaved changes" / "Not saved — try again" in a live region; `beforeunload` warns while a revision is unsaved. After a save, booths adopt the server ids and states by label (the backend upserts by label), including ids inside the undo/redo stacks.
6. **Publishing** saves first, then shows each tier's booth count and warns about booths with no tier.

## API Endpoints

Unchanged; see [floor-maps.md](floor-maps.md).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/maps/:mapId` | Org staff | Load map, booths, tiers |
| PATCH | `/admin/maps/:mapId` | Org staff | Name, width, height, unit, grid size |
| PUT | `/admin/maps/:mapId/layout` | Org staff | Whole-layout save (elements + booths by label) |
| POST | `/admin/maps/:mapId/publish` / `unpublish` | Org staff | Publish state |
| POST | `/admin/maps/:mapId/booths/:boothId/{assign,unassign,move,status}` | Org staff | Vendor panel actions |

## Database

`FloorMap.layout.elements` (JSON) and `Booth` rows. Coordinates and sizes are integers in floor units (`FloorMap.unit`); `gridSize` is only the drawing scale (pixels per unit) and is no longer shown in the UI.

## Accessibility

- Every palette tile, header control and floating-bar button is a labelled button with a visible focus ring; icon-only buttons have `aria-label`, a tooltip and `aria-keyshortcuts`.
- The canvas is `role="application"` with instructions in `aria-describedby`. Items are focusable (Tab), Enter / Space select, Shift + Enter adds to the selection, arrow keys nudge by 1 (Shift: 5), R turns, Delete removes, Ctrl/⌘ + D copies, Ctrl/⌘ + Z / Shift + Z undo and redo, Ctrl/⌘ + A selects all, B / T add a booth / table, 0 fits, ? opens the tips dialog.
- A polite live region announces adds, moves, resizes, deletes, tier changes and vendor moves.
- Dialogs trap focus, close on Escape and return focus to the opener. The flash on new items is disabled under `prefers-reduced-motion`.
- Booth labels switch between white and near-black to keep contrast on tier swatches (also on the public map).

## Gotchas

- Mouse clicks on items are handled in the canvas `pointerdown`; `Booth` / `MapElement` `onSelect` only acts on keyboard events in the builder. Do not route clicks through both.
- `commit(fn)` records an undo step; drags call `checkpoint()` once and then `commit(fn, { history: false })` per pointer move.
- Items with a temporary id (`new-booth-…`) have no vendor panel until the autosave returns server ids.
- Deleting a SOLD / HELD / RESERVED booth is refused in the UI (the backend would 409 `BOOTH_IN_USE`); the others in the selection are still deleted.
- `MapElement` draws text labels and walls inside their `x, y, w, h` box (walls as a bar along the box, text centred). Before this change a label's text sat above `y`; no layouts had elements then because the old toolbar never placed anything.
- The global key handler ignores keys while a field is focused or any `aria-modal` dialog is open.

## Related Features

- [Floor Maps and Vendor Booth Purchases](floor-maps.md)
- [Map Templates](map-templates.md)
- [Map Export](map-export.md)
- [Vendor Directory](vendor-directory.md)
