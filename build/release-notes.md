# Stick Labs 2.3.2

Adds guided MATRIX routing inside the application:

- Scan for gamepad interfaces, with a recommendation for the reported 046D:C53B MATRIX output.
- Register the bundled forwarding helper and hide only the selected gamepad interface using HidHide, with normal Windows administrator approval.
- Verify the applied configuration, retain a recovery record and undo Stick Labs changes without clearing unrelated rules.
- Keyboard/mouse and identified ViGEm interfaces are excluded; inverted HidHide mode requires advanced setup.
- Improve virtual-slot discovery: wait for enumeration and corroborate native hardware IDs when available instead of trusting only ViGEm's cached LED index. Loop and source-reassignment protection remain enabled.

Windows dependency installers and the forwarding runtime remain bundled. Stop forwarding before routing changes. Reconnect MATRIX if Windows needs it, refresh native XInput slots, and select the physical source after applying routing. Physical hardware validation remains required. Existing calibration/jitter features are preserved.
