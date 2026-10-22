# Web build dev tools

Fast test loop for the WebAssembly build: headless Chrome (real GPU through D3D11 on Windows), driven over the
DevTools protocol, jumping straight into a race with a save state.

Needs Node 22+, Python 3, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, and
your own disc image. Disc images and save states contain game data: keep them **outside the repo**
(example: `C:\ctr\assets\ctr-u.bin`, `C:\ctr\states\`).

## Server

```powershell
$env:CTR_DISC='C:\ctr\assets\ctr-u.bin'; $env:CTR_STATES='C:\ctr\states'; $env:PORT='8091'
node web\serve.mjs
```

Dev-only page options: `?disc=/disc.bin` (read the disc over HTTP Range instead of a file picker),
`&state=/state/<name>` (preload a quick save state; F8 loads it, F5 saves),
`&args=--perf-dir,/perf` (pass arguments to `main`, here the frame timing CSV).

## Runs

| Command | What | Time |
|---|---|---|
| `node web\tools\drive.mjs "http://127.0.0.1:8091/?disc=/disc.bin" out\mk web\tools\steps\make-state.json` | menus to Crash Cove, F5, saves `out\mk\new.ctrstates` (copy it to `C:\ctr\states`) | ~75 s, once |
| `node web\tools\drive.mjs "http://127.0.0.1:8091/?disc=/disc.bin&state=/state/crashcove-race.ctrstates" out\look web\tools\steps\look.json` | load the state, two screenshots | ~20 s |
| `node web\tools\sweep.mjs out\sweep --throttles=1,4,6` | CPU profile + frame CSV at several CPU slowdowns **in parallel**, then `compare.py` | ~35 s |

The state loads once the game's main loop starts, after the fixed ~15 s boot screens.
`--keep` leaves headless Chrome running on its `--port` so the next run reuses it (a fresh tab each run);
different ports run in parallel. `--swiftshader` uses the software GPU instead.
