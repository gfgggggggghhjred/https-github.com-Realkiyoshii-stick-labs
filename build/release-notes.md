# Stick Labs 2.3.0

Windows forwarding setup is now included in the application.

- Bundled XInput helper executable with its Python runtime, vgamepad and ViGEmClient DLL: no separate Python/pip installation for Xbox forwarding.
- In-app detection and installation buttons for the signed ViGEmBus driver and optional HidHide.
- Bundled Microsoft Visual C++ runtime installer for HidHide's configuration client when needed.
- Publisher-signature verification during packaging and before running an elevated installer.
- Existing driver installations are reused. Windows retains its normal administrator prompts and reboot requirements.
- A button opens HidHide's configuration client for source-device routing.

Windows x64 packages include dependency installers and license notices. The Flydigi Python bridge is separate and is not bundled by this change. ViGEmBus remains retired upstream. Input forwarding still needs real Windows/MATRIX and game validation; firmware/ADC/polling changes are not provided. Select the correct source and configure hiding or game controller selection to prevent duplicate input. Automatic keyboard/mouse hiding is deliberately not performed.
