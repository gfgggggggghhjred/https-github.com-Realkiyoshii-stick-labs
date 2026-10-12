$ErrorActionPreference = 'Stop'
$env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'
python -m pip install -r scripts/requirements-xinput-windows.txt pyinstaller==6.11.1
if ($LASTEXITCODE -ne 0) { throw 'Helper dependencies failed' }
python -m PyInstaller --noconfirm --clean --onedir --console --name sticklabs-xinput --collect-all vgamepad --distpath build/windows --workpath build/pyinstaller scripts/xinputbridge.py
if ($LASTEXITCODE -ne 0) { throw 'Helper build failed' }
# Distribute the original signed upstream installer, never a modified driver.
$driver = Join-Path $PWD 'build/windows/ViGEmBus_1.22.0_x64_x86_arm64.exe'
Invoke-WebRequest 'https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe' -OutFile $driver
$signature = Get-AuthenticodeSignature $driver
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Nefarius') { throw 'Driver publisher signature verification failed' }
