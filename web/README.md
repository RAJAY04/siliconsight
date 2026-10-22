# SiliconSight web

The browser front end. It connects to the local reader over a WebSocket and draws an exploded view of the Mac with live readings. Click a part to open its detail panel.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

In dev the page connects to `ws://127.0.0.1:7878/ws`. When built and served by the reader, it uses `ws://<page host>/ws`. Start the reader with:

```bash
cd reader && swift run -c release macviz
```

If no reader answers within 3 seconds, the page switches to synthetic demo data and shows a "Demo data" badge. It keeps trying the socket every 5 seconds and switches to live data when the reader appears. Add `?demo` to the URL to force demo mode.

Frames that aren't valid JSON, samples missing a field the view reads, and fast messages with a non-numeric finger or lid angle are dropped. A reader that sends no `sensors` and no `fast` messages still works: every sensor shows n/a and the scene keeps its fixed pose. A reader whose `hello` has a protocol version other than 1 gets a "Version mismatch" screen instead of a broken page, and an error boundary offers a reload if rendering ever throws.

## Build and check

```bash
npm run build        # type-checks, then writes web/dist
npm test             # node --test on src/*.test.ts (story detector, unit formatting, layout bounds, lid mapping, sample and fast validation, demo sensors)
npx tsc --noEmit
```

Tests run on Node's built-in runner with type stripping, so they need Node 22.18 or later. There is no test framework.

## Layout

- `src/useStream.ts` handles the socket, message validation, the demo fallback, reconnects and the 10 minute history. Fast messages (lid angle and trackpad fingers, up to 30 a second) go into a plain object the scene reads, never into React state.
- `src/demo.ts` generates demo data for an M5 with 16 GB. It includes a local LLM run about once a minute, a two-finger scroll every 14 s, the lid easing between 100 and 120 degrees once a minute, a video call (camera and mic) every two minutes and music now and then. It lists only user-level processes, as the reader does.
- `src/story.ts` produces the "What's happening" text from recent history, and holds the table of peak memory bandwidth per chip used for the LLM ceiling and the particle scale.
- `src/layout.ts` holds the MacBook Air internal layout from `docs/teardown-reference.md` as fractions of the footprint and derives every rectangle the scene draws.
- `src/Scene.tsx` draws the exploded MacBook with CSS 3D transforms and SVG. A canvas inside it draws the particles and the speaker pulse. A second, small canvas over the trackpad draws live fingers; the same loop eases the display layer to the lid angle and sleeps when nothing moves.
- `src/panels.tsx` holds the detail panels: chip, memory, battery, storage and network, power, sensors. The lid label at the top left of the scene opens the sensors panel.
- `src/App.tsx` holds the shell, side rail and hash routing (`#chip`, `#memory`, `#battery`, `#io`, `#power`, `#sensors`).
- `src/format.ts` has the unit formatters. Missing values show as "n/a", never as 0.
- `src/styles.css` defines the colour tokens (dark by default, light through `prefers-color-scheme`) and all styles.

Screenshots are in `screenshots/`.
