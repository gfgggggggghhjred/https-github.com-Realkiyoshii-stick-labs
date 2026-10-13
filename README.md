# Stick Labs — stick tuner (G7 Pro 8K · G7 Pro · Tarantula detect · G7 SE locked)

Stick-only Electron companion. No remap / macros / lighting / motion code.

## What it tunes (all in the 1070-byte profile blob)

| Area | Bytes | UI |
|---|---|---|
| Bit depth 8–12 + raw unlock | `Fun_Data +16`, wire = `12 − bits` | standard buttons + raw wire 0–255 |
| Polling rate 250–8K | `Fun_Data +14`, gear 0–5 | 1K/2K/4K/8K buttons (+250/500); |
| Deadzone 0.1% steps | stick `+3..+10`, u16BE ×10 | 4 sliders + Physics / Factory presets |
| Response curve | stick `+14..+23`, 5× (x,y) | presets + plot + numeric table |
| Gate / output | stick `+1,+27,+28,+29` | square gate, axis ratio, output type, mouse DPI |
| Calibration | `0F FE <calType> <mask>` | Enter / Commit / Cancel |

Hardware truth: the ADC maxes at **12-bit (4096 levels)**. Raw wires outside
`0–4` (resolution) / `1–21` 
## Run

```powershell
$env:PATH = 'C:\Users\Kai\AppData\Local\hermes\node;' + $env:PATH
npm.cmd install
npm.cmd run dev
```

Close **GameSir Connect** first — it holds the HID handle.
Match is `VID 0x3537 + usagePage 0xFFF0/usage 0x40`; never match PID.

Writing the **running** slot reboots the pad (~1–2 s). The write path reads
back and verifies; a failed verify restores the previous bytes.

## Checks

```powershell
$env:PATH = 'C:\Users\Kai\AppData\Local\hermes\node;' + $env:PATH
npx.cmd tsc --noEmit -p tsconfig.node.json
npx.cmd tsc --noEmit -p tsconfig.web.json
node scripts/test.mjs tests/rawbytes.ts
npx.cmd electron-vite build
```

## EXE / installer

```powershell
npm.cmd run dist   # NSIS setup + portable exe in dist/
```

Unsigned, so Windows SmartScreen will ask on first run — click through.
Re-run `dist` after any code change; the desktop shortcut runs the dev
build, the installer is the shareable artifact.

## Public release (GitHub)

1. Create the repo, push this folder as its root.
2. In `package.json` → `build.publish`, replace `YOUR_GITHUB_USER` /
   `stick-labs` with the real owner/repo.
3. (Later, optional) Code-signing: set `CSC_LINK`/`CSC_KEY_PASSWORD` in
   CI secrets and SmartScreen warnings fade as reputation builds.
4. Cut a release: bump `version`, commit, `git tag v1.0.0`, `git push --tags`.
   CI typechecks, tests, builds, and publishes both exes to the Release —
   and packaged apps auto-update from those Releases.

## Xbox 360 / XInput support (2.2.0)

Open **Xbox 360 / XInput** to select standard Windows gamepad output and test sticks, triggers, buttons and axis ranges. Deadzone, saturation, response exponent and inversion can be previewed and saved locally.

Experimental Windows forwarding sends adjusted sticks and passthrough triggers/buttons to a virtual Xbox 360 controller for games that accept virtual XInput. It requires Python, vgamepad and signed ViGEmBus, with source-device routing configured separately. Actual Windows/MATRIX hardware behavior remains unverified; this release does not guarantee compatibility with every game.

See [Windows setup and feature coverage](docs/xim-matrix.md). Continue using MATRIX Manager and Wootility to edit hardware settings.

Run the software checks with `npm run typecheck`, `npm test`, `python tests/test_xinputbridge.py`, and `npm run build`.

## Downloads

Windows installers and portable executables are published at https://github.com/gfgggggggghhjred/https-github.com-Realkiyoshii-stick-labs/releases . The older source ZIP remains in the repository for reference.

## Included Windows setup (2.3.0)

Windows x64 downloads bundle the Xbox forwarding runtime and driver installers. Use **Windows forwarding setup** inside the Xbox 360 / XInput panel; Python and pip are no longer required for that feature. Driver setup still requires Windows administrator approval, and source-device routing is a guided manual step. See [setup instructions](docs/xim-matrix.md) and [runtime notices](docs/windows-runtime-notices.md).
