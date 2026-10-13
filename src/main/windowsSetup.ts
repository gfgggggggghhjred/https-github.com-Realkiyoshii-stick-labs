import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import type { WindowsDriver, WindowsSetupStatus } from '../shared/windowsSetup'
const execute = promisify(execFile)
let installing = false
function resources(): string {
  return app.isPackaged ? join(process.resourcesPath, 'windows-runtime') : join(app.getAppPath(), 'build', 'windows-runtime')
}
function quote(value: string): string { return "'" + value.replace(/'/g, "''") + "'" }
async function powershell(script: string, timeout = 30000): Promise<string> {
  const encoded = Buffer.from("$ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; " + script, 'utf16le').toString('base64')
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 })
  return result.stdout.trim()
}
export async function windowsSetupStatus(): Promise<WindowsSetupStatus> {
  if (process.platform !== 'win32') return { supported: false, bundled: false, vigemInstalled: false, hidHideInstalled: false }
  const result = await powershell("@{ vigemInstalled = (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\ViGEmBus'); hidHideInstalled = (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\HidHide') } | ConvertTo-Json -Compress")
  return { supported: true, bundled: existsSync(join(resources(), 'xinputbridge', 'xinputbridge.exe')), ...JSON.parse(result) }
}
export async function installWindowsDriver(driver: WindowsDriver): Promise<{ rebootRequired: boolean }> {
  if (process.platform !== 'win32') throw new Error('Driver setup requires Windows')
  if (driver !== 'vigem' && driver !== 'hidhide') throw new Error('Unknown driver')
  if (installing) throw new Error('Another driver installer is already running')
  const file = join(resources(), 'drivers', driver === 'vigem' ? 'ViGEmBus.exe' : 'HidHide.exe')
  if (!existsSync(file)) throw new Error('Bundled driver installer is missing. Use the latest packaged Windows build.')
  installing = true
  try {
    const runInstaller = async (installer: string, publisher: string): Promise<boolean> => {
      const output = await powershell(`$p = ${quote(installer)}; $s = Get-AuthenticodeSignature $p; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch ${quote(publisher)}) { throw 'Installer publisher signature could not be verified. Installation cancelled.' }; $process = Start-Process -FilePath $p -Verb RunAs -Wait -PassThru; @{ exitCode = $process.ExitCode } | ConvertTo-Json -Compress`, 15 * 60 * 1000)
      const code = JSON.parse(output).exitCode
      if (code !== 0 && code !== 3010 && code !== 1641) throw new Error(`Installer exited with code ${code}. If you cancelled administrator approval, run setup again when ready.`)
      return code === 3010 || code === 1641
    }
    let rebootRequired = false
    if (driver === 'hidhide') {
      const installed = await powershell("$p = 'HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64'; if ((Test-Path $p) -and (Get-ItemProperty $p).Installed -eq 1) { 'yes' } else { 'no' }")
      if (installed !== 'yes') {
        const redist = join(resources(), 'drivers', 'VC_redist.x64.exe')
        if (!existsSync(redist)) throw new Error('Bundled Microsoft runtime installer is missing. Reinstall Stick Labs.')
        rebootRequired = await runInstaller(redist, 'Microsoft')
      }
    }
    return { rebootRequired: await runInstaller(file, 'Nefarius') || rebootRequired }
  } finally { installing = false }
}
export async function openHidHideSetup(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Routing setup requires Windows')
  const base = process.env.ProgramFiles || 'C:\\Program Files'
  const candidates = [
    join(base, 'Nefarius Software Solutions e.U.', 'HidHideClient', 'HidHideClient.exe'),
    join(base, 'Nefarius Software Solutions e.U', 'HidHideClient', 'HidHideClient.exe'),
    join(base, 'Nefarius Software Solutions e.U.', 'HidHide', 'x64', 'HidHideClient.exe')
  ]
  const file = candidates.find(existsSync)
  if (!file) throw new Error('HidHide Configuration Client was not found. Finish installing HidHide and use its Start menu entry if needed.')
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
}
export function bundledHelperPath(): string { return join(resources(), 'xinputbridge', 'xinputbridge.exe') }
