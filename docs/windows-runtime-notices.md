# Bundled Windows runtime

Stick Labs packages its XInput forwarding helper with CPython and vgamepad from pinned upstream commit c1d728a6813760a5be21ac9379f4b23347fe8345 (the source identifies itself as 0.1.3) using PyInstaller 6.11.1. Python or pip installation on the user's machine is not required for packaged forwarding. The Flydigi bridge is a separate feature and is not converted by this change.

The runtime includes vgamepad's ViGEmClient DLL. Official production-signed ViGEmBus 1.22.0 and HidHide 1.5.230.0 installers are redistributed with their license notices. ViGEmBus is retired upstream. Bundling does not change its support status. Driver installation is optional, uses normal Windows elevation and preserves signature verification.

CPython is distributed under its Python Software Foundation license. vgamepad is MIT licensed. ViGEmBus and HidHide license copies accompany the runtime. PyInstaller's GPL license includes its bootloader exception permitting distribution of bundled applications; see https://pyinstaller.org/en/stable/license.html . No endorsement by these projects is implied.

The Microsoft Visual C++ x64 Redistributable installer is included for HidHide’s configuration client prerequisite. It is obtained from Microsoft, verified against a valid Microsoft Authenticode signature, and installed through the original Microsoft installer only when needed. Its use is subject to Microsoft’s included terms; see https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist .
