# Stick Labs 2.2.0

Adds an Xbox 360 / XInput panel for testing standard Windows gamepad output, including Wooting 60HE -> XIM MATRIX -> Windows setups.

- Live sticks, triggers, button indicators and axis range diagnostics.
- Diagnostic JSON exports and validated local preview presets.
- Deadzone, outer saturation, response exponent and axis inversion adjustments.
- Experimental Windows forwarding to a virtual Xbox 360 controller: buttons and triggers pass through; stick transforms apply to both sticks.
- Explicit native XInput source selection, feedback-loop slot checks, neutral shutdown, source-disconnect stop and a control-connection watchdog.
- Corrected the default test runner to execute existing suites; Windows release CI also runs the Python backend tests.

## Windows forwarding requirements and limitations

Forwarding requires separately installed Python, vgamepad 0.1.3 and a production-signed ViGEmBus driver. ViGEmBus is retired upstream. HidHide or game-specific controller selection may be needed to prevent duplicate input. See docs/xim-matrix.md in the repository for installation and routing steps.

The backend has automated simulation coverage but has not been validated on physical Windows/MATRIX hardware. Compatibility with every Windows game is not guaranteed. Rumble and Guide-button extensions are not forwarded. Host-side transforms do not change MATRIX/Wooting firmware, hardware polling rate, sensor bit depth, calibration or onboard profiles. Manager and Wootility remain the tools for hardware settings.
