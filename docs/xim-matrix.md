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

## Windows forwarding setup (2.3.1)

The installer and portable Windows x64 application include the forwarding helper, Python runtime, vgamepad and ViGEmClient. You do not need Python or pip for packaged Xbox forwarding. Driver installers and license notices are bundled under resources/windows-runtime. Portable mode still requires machine-level drivers; it is not a driver-free application.

1. Open **Xbox 360 / XInput** and locate **Windows forwarding setup**.
2. If the virtual controller driver is missing, click **Install virtual controller driver** and approve the normal Windows administrator prompt. The app verifies the Nefarius publisher signature before launching the official ViGEmBus installer.
3. If your game cannot select the virtual controller instead of the original MATRIX output, click **Install optional HidHide**. Its prerequisite Microsoft runtime is installed first if missing, through the signed Microsoft installer. Restart Windows if either installer requests it.
4. Open **device routing setup**. In HidHide's Applications list, allow the exact bundled helper, `resources/windows-runtime/xinputbridge/xinputbridge.exe` under your Stick Labs installation. Select only MATRIX's gamepad interface for hiding, leaving keyboard and mouse interfaces visible. The program does not change hide lists or whitelist rules automatically.
5. Connect MATRIX first, refresh Windows XInput slots, move mapped analog keys and identify the native source slot from the displayed readings. Browser indices and Windows slots are separate.
6. Confirm routing, choose adjustments, then **Start forwarding**. Apply further edits with **Apply edited settings to output**. Keep Stick Labs open; switching tabs does not stop forwarding.
7. Verify that the game reads only the virtual controller and test buttons/triggers, neutral release and disconnect handling. Stop forwarding before rearranging controllers. Some games need a specific slot or disallow virtual devices; universal game compatibility has not been established.

Both sticks share radial deadzone/saturation/curve settings (including a circular output gate at defaults). Buttons and triggers pass through. Guide-button extensions and rumble return traffic are not implemented. Host loop timing is not USB polling rate or guaranteed game latency. MATRIX firmware/profile editing and Wooting configuration remain in their official tools.

For development builds without a bundled helper, the existing Python fallback is retained. Set `VGAMEPAD_SKIP_VIGEMBUS_INSTALL=true` and install `scripts/requirements-xinput-windows.txt` into the Python interpreter chosen by `STICKLABS_PYTHON`; this is unnecessary for packaged downloads. Flydigi uses a separate Python bridge and retains its original requirements.

Build the bundled helper and verified dependencies on Windows using `scripts/build-windows-runtime.ps1`. The CI runtime smoke check loads native XInput and the collected ViGEmClient DLL without requiring a physical source or installed bus driver. Signatures must validate; do not bypass verification to fix a download or installation problem.

## Backend validation limits

Fifteen Python tests with injected source/target adapters cover native axis endpoints and Y orientation, transform math, buttons/triggers passthrough, settings validation, explicit source selection, virtual-index conflict rejection, full XInput slots, source disconnect, no automatic reattachment, watchdog timeout, stop and output exclusion from the source list. These are simulation tests; they do not load the Windows driver or validate Windows packaging. The helper emits a clear unsupported-platform result on Linux. Real XInput/ViGEmBus/HidHide integration and actual game compatibility require local Windows verification.

The calibration and dual-stick jitter additions from version 2.3.0 are preserved. Center/range corrections are host-side output transforms and do not change factory calibration.

## Guided routing and slot verification (2.3.2)

After installing HidHide in Windows forwarding setup, use **Scan routing devices**. The reported MATRIX VID_046D/PID_C53B interface is recommended when exactly one match exists. Choose the gamepad interface, confirm that it is your MATRIX output and click **Set up routing**. The wizard registers the exact bundled helper executable, adds only the chosen interface to HidHide, enables cloaking and reads the configuration back to verify it. Normal Windows elevation may be requested. It does not clear existing rules, hide whole USB containers or switch inverted whitelist modes.

Keyboard/mouse interfaces and identified ViGEm-backed interfaces are excluded. If HidHide has existing hidden rules but cloaking is off, enabling routing activates those existing rules too; the wizard displays this before you confirm. A recovery record is written before changes, so interrupted setup can be undone. **Undo Stick Labs routing** restores the selected interface and helper permission only when Stick Labs added them. Global cloaking is restored only if the unrelated hide list has not changed. Do not change source connections while forwarding.

After applying routing, reconnect MATRIX if needed and refresh **Windows XInput slots**. Browser gamepad input for the hidden physical device may disappear; the allowed helper can still read it. Use the native source selector for forwarding, and the virtual output for browser testing. The installed application is recommended over portable mode for stable HidHide helper paths. Portable extraction/update paths may require Undo and setup again.

ViGEm's user-index query is backed by its cached LED state. Startup now waits for a stable independent slot. For differently identified physical/virtual devices, the bridge can corroborate the one newly enumerated native XInput slot using the optional hardware-ID query used by SDL's Windows backend. Ambiguous candidates and source identity changes stop forwarding. Hardware-ID support is optional: when unavailable, the strict reported-slot check remains. The error includes source, before/after slots and the driver's LED index for diagnosis; loop protection must not be disabled to force forwarding.

### Connect & set up (2.3.3)

1. Install Stick Labs using the Windows setup executable and connect MATRIX.
2. Open Xbox 360 / XInput and click **Connect & set up**. Complete missing driver installers and Windows administrator prompts. If a restart is requested, restart and click the button again.
3. Confirm the scanned MATRIX gamepad interface and click **Set up routing**. Only that gamepad is hidden; the bundled helper is allowed to read it. Keyboard and mouse interfaces stay visible.
4. The helper launches and Windows source slots refresh automatically. Verify the source selection, confirm game routing, and click **Start forwarding**. If routing was configured previously, use **Launch helper & refresh slots**.
5. **Open advanced HidHide application** opens the installed configuration client when manual troubleshooting is needed; **Undo Stick Labs routing** reverses this app's changes. MATRIX Manager and Wootility remain separate tools for hardware configuration.

### Faster jitter (2.3.4)

Jitter speed selects 0.2–60 new random targets per second for each enabled stick. Use **Fast · 16/s** to try quicker movement at the current strength; **Very fast · 32/s** is another comparison point. Speed and the left/right strength percentages are separate. Existing presets keep their saved speed. While forwarding, click **Apply edited settings to output** after editing. Zero strength disables jitter, including at rest.

These are random target changes, not a periodic waveform or USB polling rate. The browser display may miss fast changes between frames; judge actual forwarded output and game feel as well. Jitter changes the generated offset without time-filtering the underlying stick input.

### Windows setup fixes (2.3.5)

Scan routing devices, Open advanced HidHide application, and Check setup again now report their progress and results beside the buttons. Scanning and checking are available while forwarding runs; stop forwarding before changing routing. If a scan fails, its error stays visible and the controls unlock for another attempt. Use **Install / repair HidHide** if the tools are missing.

Tool discovery supports the bundled `Program Files\Nefarius Software Solutions\HidHide\x64` layout, the newer flat HidHide directory, and older separate client/CLI directories. HidHide's command-line tool must receive EOF on its redirected input to finish; the app now closes that input immediately.
