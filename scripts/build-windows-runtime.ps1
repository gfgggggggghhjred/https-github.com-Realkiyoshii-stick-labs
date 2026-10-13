$ErrorActionPreference = 'Stop'
$env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'
python -m pip install -r scripts/requirements-xinput-windows.txt pyinstaller==6.11.1
if ($LASTEXITCODE -ne 0) { throw 'Python build dependencies failed' }
python -m PyInstaller --noconfirm --clean --onedir --console --name xinputbridge --distpath build/windows-runtime --workpath build/pyinstaller-work --specpath build/pyinstaller-spec --collect-binaries vgamepad --hidden-import vgamepad.win.virtual_gamepad --hidden-import vgamepad.win.vigem_client scripts/xinputbridge.py
if ($LASTEXITCODE -ne 0) { throw 'Forwarding helper build failed' }
& build/windows-runtime/xinputbridge/xinputbridge.exe --runtime-check
if ($LASTEXITCODE -ne 0) { throw 'Bundled Windows runtime smoke check failed' }
$destination = 'build/windows-runtime/drivers'
New-Item -ItemType Directory -Force $destination | Out-Null
$drivers = @(
    @{ Publisher = 'Nefarius'; Name = 'ViGEmBus.exe'; Url = 'https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe' },
    @{ Publisher = 'Nefarius'; Name = 'HidHide.exe'; Url = 'https://github.com/nefarius/HidHide/releases/download/v1.5.230.0/HidHide_1.5.230_x64.exe' },
    @{ Publisher = 'Microsoft'; Name = 'VC_redist.x64.exe'; Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe' }
)
foreach ($driver in $drivers) {
    $file = Join-Path $destination $driver.Name
    Invoke-WebRequest -Uri $driver.Url -OutFile $file
    $signature = Get-AuthenticodeSignature $file
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch $driver.Publisher) {
        throw "Driver signature validation failed for $($driver.Name): $($signature.Status)"
    }
    Get-FileHash -Algorithm SHA256 $file
}
$licenses = 'build/windows-runtime/licenses'
New-Item -ItemType Directory -Force $licenses | Out-Null
Invoke-WebRequest 'https://raw.githubusercontent.com/nefarius/ViGEmBus/v1.22.0/LICENSE' -OutFile (Join-Path $licenses 'ViGEmBus-LICENSE.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/nefarius/HidHide/v1.5.230.0/LICENSE' -OutFile (Join-Path $licenses 'HidHide-LICENSE.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/yannbouteiller/vgamepad/v0.1.3/LICENSE' -OutFile (Join-Path $licenses 'vgamepad-LICENSE.txt')
Copy-Item docs/windows-runtime-notices.md $licenses
Copy-Item (Join-Path $env:pythonLocation 'LICENSE.txt') (Join-Path $licenses 'Python-LICENSE.txt')
