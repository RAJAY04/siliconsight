# MacOS visualizer web

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

Frames that aren't valid JSON, or samples missing a field the view reads, are dropped. A reader whose `hello` has a protocol version other than 1 gets a "Version mismatch" screen instead of a broken page, and an error boundary offers a reload if rendering ever throws.

## Build and check

```bash
npm run build        # type-checks, then writes web/dist
npm test             # node --test on src/*.test.ts (story detector, unit formatting, layout bounds, sample validation)
npx tsc --noEmit
```

Tests run on Node's built-in runner with type stripping, so they need Node 22.18 or later. There is no test framework.

## Layout

- `src/useStream.ts` handles the socket, message validation, the demo fallback, reconnects and the 10 minute history.
- `src/demo.ts` generates demo data for an M5 with 16 GB. It includes a local LLM run about once a minute, and lists only user-level processes, as the reader does.
- `src/story.ts` produces the "What's happening" text from recent history, and holds the table of peak memory bandwidth per chip used for the LLM ceiling and the particle scale.
- `src/layout.ts` holds the MacBook Air internal layout from `docs/teardown-reference.md` as fractions of the footprint and derives every rectangle the scene draws.
- `src/Scene.tsx` draws the exploded MacBook with CSS 3D transforms and SVG. A canvas inside it draws the particles.
- `src/panels.tsx` holds the detail panels: chip, memory, battery, storage and network, power.
- `src/App.tsx` holds the shell, side rail and hash routing (`#chip`, `#memory`, `#battery`, `#io`, `#power`).
- `src/format.ts` has the unit formatters. Missing values show as "n/a", never as 0.
- `src/styles.css` defines the colour tokens (dark by default, light through `prefers-color-scheme`) and all styles.

Screenshots are in `screenshots/`.
