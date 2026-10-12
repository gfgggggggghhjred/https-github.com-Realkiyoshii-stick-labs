# XIM MATRIX with Wooting 60HE

Target setup reported by the user: Wooting 60HE in Xbox analog mode, connected to XIM MATRIX; MATRIX firmware and Manager 7.00.20260714. Windows reports USB VID_046D/PID_C53B with xusb22.inf. Treat that ID as the adapter's presented interface, not proof of a Logitech controller or a configuration protocol.

Open **Xbox 360 / XInput** in the sidebar, focus the app, press a mapped key and select the adapter's Windows gamepad output. Standard Gamepad API mapping is required; unsupported mappings are listed but cannot be selected. Selection is explicit so another connected gamepad is not silently used. The keyboard must be configured to produce analog gamepad output through MATRIX.

Readings include all upstream processing. The test panel does not measure raw Wooting travel, sensor resolution, USB polling rate or end-to-end latency. It samples browser state approximately 30 times per second. Exported diagnostics record the current sample, axis ranges, browser device identity, local preview and user-reported versions.

## Feature coverage

| Existing Stick Labs feature | MATRIX / Wooting coverage |
| --- | --- |
| Controller discovery/connect | Explicit standard Gamepad API output selection; no HID configuration session |
| Live sticks | Both normalized axes, visual plots and numeric readings |
| Triggers/buttons | Standard-mapped LT/RT percentages and button indicators |
| Lab axis ranges | Min/max/span per axis; pause, reset and diagnostic JSON export |
| Lab USB rate/command ping | Unavailable; browser sampling is not device polling or protocol latency |
| Deadzone and outer saturation | Radial local preview; adjustable virtual output through Windows forwarding |
| Response curve | Exponent preview and virtual-output transform; not the GameSir five-point device curve |
| Axis inversion | Local preview and Windows virtual-output transform |
| Local preset persistence/import/export | Validated versioned preview JSON; not a MATRIX configuration backup |
| Four onboard profile slots/read/write/switch | Not implemented for MATRIX |
| Device profile backup/restore/copy | Not implemented for MATRIX |
| Calibration workflows | Not implemented; observing resting output is not factory calibration |
| Polling rate/bit depth/raw resolution/anti-jitter | Not implemented; no verified MATRIX commands |
| Anti-deadzone, square gate, axis ratio, output type/mouse DPI, adaptive centre | No equivalent implemented for MATRIX |
| Steam export | Existing GameSir workflow unchanged; not wired into this panel |
| Factory reset/read-back/rollback | No MATRIX writes, so no device reset or write verification |
| Language selection | Existing app language selection remains; new panel copy currently English |

## Editing actual hardware settings

Use MATRIX Manager to edit and save the adapter settings and Wootility for keyboard analog settings. Stick Labs does not yet implement a verified Manager-compatible configuration transport or codec for the reported firmware. The official guide at https://guide.xim.tech/ returned HTTP 403 in the cloud during investigation; no configuration API was verified. Do not infer proprietary write commands from the Xbox output ID, reuse GameSir writes, or label local preview changes as applied to hardware.

Remaining implementation prerequisite: documented/verified MATRIX configuration transport and encoding for this firmware, or owner-provided protocol captures/configuration fixtures with controlled before/after settings. Actual device support must then be tested with the user's hardware, including read-back and preservation of unrelated settings. Firmware and Manager versions in this panel are reported metadata, not device-query results.

## Validation

`npm run typecheck`, `npm run build`, and `node scripts/test.mjs tests/xinput.ts` validate the code and mapping/preview math. The existing explicit GameSir/Flydigi suites should also pass. Electron UI checks may simulate Gamepad API data; simulation does not establish real Windows/MATRIX compatibility. Hardware input and settings editing remain unverified in cloud.

## Applying adjustments to game input

XInput reports controller state; it has no API for writing controller deadzones, curves, polling or onboard profiles. Applying host-side transforms requires routing modified state to the game, independently of MATRIX Manager and Wootility.

For Steam titles, investigate per-game Steam Input settings. The existing Steam exporter starts from a generic template and overwrites per-game files; do not reuse it for this panel without preserving the user's current bindings and choosing specific target games.

For all Windows titles, a virtual controller backend and source-device routing are required. A native Windows helper must read an explicitly selected XInput slot, transform it and submit to a virtual Xbox device. Ensure the virtual output is never re-selected as its own source; handle source loss by publishing neutral state. Games must use the adjusted virtual device rather than both source and virtual devices. A signed virtual-controller driver and Windows hardware validation are prerequisites. The cloud Linux environment cannot establish Windows driver readiness. A Windows-only Python backend is now implemented, using native XInputGetState and vgamepad/ViGEmBus. It is not validated on real Windows hardware yet.

## Windows forwarding setup

This backend changes the input presented by a **virtual Xbox 360 controller**, not MATRIX settings. Games outside Steam can use this standard XInput device, but individual games may require a specific controller slot or reject virtual controllers. Universal game compatibility has not been established. Source and virtual outputs must not both control the game.

1. Packaged Windows releases include the standalone helper and its Python/vgamepad libraries. No separate Python installation is needed. Click **Install / repair Windows driver** in the XInput panel to launch the bundled signed ViGEmBus installer. Approve Windows elevation and restart if requested. ViGEmBus is retired upstream; real Windows compatibility remains unverified.
2. For development only, install Python and set `STICKLABS_PYTHON` if necessary. Set `VGAMEPAD_SKIP_VIGEMBUS_INSTALL=true` before installing `scripts/requirements-xinput-windows.txt` so pip does not launch the older driver installer.
3. Driver signature and Nefarius publisher are verified at build time and before launching setup. Windows packaging requires network access to the official upstream release.

4. Connect MATRIX first. Keep other controllers disconnected while initially validating source selection. Open **Xbox 360 / XInput**, adjust the local settings and refresh **Windows XInput slots**. Move mapped analog keys and use the displayed native axis/trigger values to identify the correct source. The browser index is deliberately not used as a Windows XInput slot.
5. Configure the game to use the virtual controller. For games that cannot select a controller, use the official HidHide utility (https://github.com/nefarius/HidHide/releases): allow the bundled `resources/windows/sticklabs-xinput/sticklabs-xinput.exe` (or the development Python interpreter) to see the physical source, and hide only MATRIX's gamepad interface from other applications. Do not hide keyboard/mouse interfaces. Stick Labs offers driver setup but does not modify HidHide rules automatically. This configuration requires local Windows access and administrator approval when installing drivers.
6. Confirm the source/routing checkbox, then **Start forwarding**. The UI reports source and virtual slot numbers only after the virtual target is allocated and its native index is verified not to overlap any occupied input slot. If all four XInput slots are occupied, startup refuses to allocate a target.
7. Further edits remain previews until **Apply edited settings to output** is clicked. Both sticks share deadzone, exponent, saturation and inversion; center/travel calibration applies only to the left stick. Independent jitter sliders apply smooth variation to either stick. Transformation is radial (a circular gate), including at defaults; resetting preview does not necessarily reproduce a square-gated physical output.
8. Test movement, triggers and buttons in the game's controller screen. Ensure the game uses the virtual controller only. Test release-to-neutral, disconnect and stop behavior before normal use. Source loss stops forwarding; reconnect requires explicit source selection and restart. Do not rearrange devices while forwarding, since XInput provides slot state rather than persistent device identity.
9. Click **Stop forwarding** before changing devices or returning to unadjusted input. A normal helper shutdown sends a neutral report before removing the virtual device. The helper also stops on a five-second control watchdog timeout and on stdin EOF. Backend forwarding continues if the UI tab is changed; quit the app or click Stop to end it.

The helper targets roughly a 4 ms host loop. This is not a USB polling-rate change or a guaranteed latency/rate. Guide-button extensions and rumble/force feedback return traffic are not implemented. Firmware calibration, ADC precision and MATRIX onboard profile management remain in the manufacturer tools.

## Backend validation limits

Fifteen Python tests with injected source/target adapters cover native axis endpoints and Y orientation, transform math, buttons/triggers passthrough, settings validation, explicit source selection, virtual-index conflict rejection, full XInput slots, source disconnect, no automatic reattachment, watchdog timeout, stop and output exclusion from the source list. These are simulation tests; they do not load the Windows driver or validate Windows packaging. The helper emits a clear unsupported-platform result on Linux. Real XInput/ViGEmBus/HidHide integration and actual game compatibility require local Windows verification.
