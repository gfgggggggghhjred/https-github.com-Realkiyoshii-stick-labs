# Stick Labs 2.3.0

Windows releases now include the standalone virtual-controller helper and its Python/vgamepad libraries, with in-app installation or repair of the original signed ViGEmBus driver.

- Stable resting-center and full-travel software calibration for the left stick.
- Linear, precision, and quick-response curves with a response graph.
- Independent left/right jitter sliders (0–5%) and a shared variation rate.
- An Always on option for each stick to continue jitter at rest. Otherwise release returns to neutral; zero strength disables jitter.
- Calibration and jitter settings save locally and travel with exported presets. Apply edited settings while forwarding to update game output.

Driver installation requires administrator approval and may require a restart. ViGEmBus is retired upstream. Game-specific controller selection or HidHide routing may still be necessary; allow the bundled sticklabs-xinput.exe helper when using HidHide. Always-on jitter can move your character or camera at rest.

Typechecks, the existing test suites, 15 Python simulation tests, and the application build pass. Real Windows/MATRIX hardware behavior remains unverified. These are host-side adjustments, not firmware calibration; rumble and Guide-button extensions are not forwarded.
