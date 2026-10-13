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
  if (installing || routingBusy) throw new Error('Another Windows setup operation is already running')
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

// Only a freshly enumerated gamepad interface may be changed by the wizard.
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { cliEntries, safeRoutingDevice, type RoutingState } from '../shared/hidHideRouting'
let routingBusy = false
interface RoutingJournal { id: string; helper: string; hiddenBefore: string[]; allowedBefore: boolean; activeBefore: boolean }
function routingJournalPath(): string { return join(app.getPath('userData'), 'xinput-routing.json') }
function hidHideCli(): string {
  if (process.platform !== 'win32') throw new Error('Routing setup requires Windows')
  const base = process.env.ProgramFiles || 'C:\\Program Files'
  const paths = ['Nefarius Software Solutions e.U.', 'Nefarius Software Solutions e.U'].map(company => join(base, company, 'HidHideCLI', 'HidHideCLI.exe'))
  const cli = paths.find(existsSync)
  if (!cli) throw new Error('Install HidHide above and restart Windows if requested, then scan again.')
  return cli
}
async function cliRead(args: string[]): Promise<string> {
  const result = await execute(hidHideCli(), args, { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  return result.stdout.trim()
}
async function journal(): Promise<RoutingJournal | null> {
  try { return JSON.parse(await readFile(routingJournalPath(), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Routing recovery record cannot be read. Use advanced HidHide setup before changing routing.')
  }
}
export async function windowsRoutingState(): Promise<RoutingState> {
  const cli = hidHideCli()
  // XUSB endpoints are not necessarily HID collections; include only their dedicated gamepad service.
  const json = await powershell(`$items = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Present -and $_.Service -match '^xusb(21|22)?$' -and $_.PNPDeviceID.StartsWith('USB\\') } | ForEach-Object { $p = (Get-PnpDeviceProperty -InstanceId $_.PNPDeviceID -KeyName DEVPKEY_Device_Parent -ErrorAction SilentlyContinue).Data; @{ id = $_.PNPDeviceID; name = $_.Name; service = $_.Service; parent = $p } }); ConvertTo-Json -InputObject $items -Compress`)
  const pnp = JSON.parse(json) as Array<{ id: string; name: string; service: string; parent: string }>
  const groups = JSON.parse(await cliRead(['--dev-gaming'])) as Array<{ friendlyName: string; devices: Array<{ present: boolean; gamingDevice: boolean; deviceInstancePath: string; description: string; baseContainerDeviceInstancePath?: string }> }>
  const raw = [...pnp, ...groups.flatMap(g => g.devices.filter(d => d.present && d.gamingDevice).map(d => ({ id: d.deviceInstancePath, name: g.friendlyName || d.description, gaming: true, parent: d.baseContainerDeviceInstancePath })))]
  const devices = [...new Map(raw.map(safeRoutingDevice).filter((d): d is NonNullable<typeof d> => !!d).map(d => [d.id.toUpperCase(), d])).values()]
  const hidden = cliEntries(await cliRead(['--dev-list']), 'dev-hide')
  const active = (await cliRead(['--cloak-state'])).includes('--cloak-on')
  const saved = await journal()
  return { devices, active, hiddenCount: hidden.length, configuredDevice: saved?.id ?? null }
}
async function cliChange(args: string[]): Promise<void> {
  const script = `& ${quote(hidHideCli())} ${args.map(quote).join(' ')}; if ($LASTEXITCODE -ne 0) { throw ('HidHide configuration failed: ' + $LASTEXITCODE) }`
  const encoded = Buffer.from("$ErrorActionPreference = 'Stop'; " + script, 'utf16le').toString('base64')
  const result = await powershell(`$r = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',${quote(encoded)}) -Verb RunAs -Wait -PassThru; if ($r.ExitCode -ne 0) { throw 'Routing setup was cancelled or failed. Use Undo routing to recover any partial change.' }`, 120000)
  void result
}
export async function applyWindowsRouting(id: string): Promise<RoutingState> {
  if (routingBusy || installing) throw new Error('Another Windows setup operation is running')
  routingBusy = true
  try {
    const state = await windowsRoutingState()
    const selected = state.devices.find(d => d.id === id)
    if (!selected) throw new Error('Select a currently connected gamepad interface; keyboard/mouse interfaces cannot be hidden by this wizard.')
    if (await journal()) throw new Error('Undo the existing Stick Labs routing setup before configuring it again.')
    const helper = bundledHelperPath()
    if (!existsSync(helper)) throw new Error('Use a packaged Windows build with the bundled forwarding helper.')
    if ((await cliRead(['--inv-state'])).includes('--inv-on')) throw new Error('HidHide is in inverted mode. Turn that off in advanced setup before using this wizard.')
    const hiddenBefore = cliEntries(await cliRead(['--dev-list']), 'dev-hide')
    const apps = cliEntries(await cliRead(['--app-list']), 'app-reg')
    const saved: RoutingJournal = { id, helper, hiddenBefore, allowedBefore: apps.some(p => p.toLowerCase() === helper.toLowerCase()), activeBefore: state.active }
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(routingJournalPath(), JSON.stringify(saved), { flag: 'wx' })
    // Register the reader before enabling hiding. Existing entries remain unchanged.
    await cliChange(['--app-reg', helper, '--dev-hide', id, '--cloak-on'])
    const after = await windowsRoutingState()
    const hidden = cliEntries(await cliRead(['--dev-list']), 'dev-hide')
    const allowed = cliEntries(await cliRead(['--app-list']), 'app-reg')
    if (!after.active || !hidden.some(p => p.toLowerCase() === id.toLowerCase()) || !allowed.some(p => p.toLowerCase() === helper.toLowerCase())) throw new Error('Routing did not verify. Use Undo routing, then retry setup.')
    return after
  } finally { routingBusy = false }
}
export async function undoWindowsRouting(): Promise<RoutingState> {
  if (routingBusy || installing) throw new Error('Another Windows setup operation is running')
  routingBusy = true
  try {
    const saved = await journal()
    if (!saved) return windowsRoutingState()
    const args: string[] = []
    if (!saved.hiddenBefore.some(p => p.toLowerCase() === saved.id.toLowerCase())) args.push('--dev-unhide', saved.id)
    if (!saved.allowedBefore) args.push('--app-unreg', saved.helper)
    const current = cliEntries(await cliRead(['--dev-list']), 'dev-hide').filter(p => p.toLowerCase() !== saved.id.toLowerCase())
    const before = saved.hiddenBefore.filter(p => p.toLowerCase() !== saved.id.toLowerCase())
    if (!saved.activeBefore && JSON.stringify(current.map(p => p.toLowerCase()).sort()) === JSON.stringify(before.map(p => p.toLowerCase()).sort())) args.push('--cloak-off')
    if (args.length) await cliChange(args)
    const hidden = cliEntries(await cliRead(['--dev-list']), 'dev-hide')
    if (!saved.hiddenBefore.some(p => p.toLowerCase() === saved.id.toLowerCase()) && hidden.some(p => p.toLowerCase() === saved.id.toLowerCase())) throw new Error('Undo did not verify; the recovery record was kept.')
    const allowed = cliEntries(await cliRead(['--app-list']), 'app-reg')
    if (!saved.allowedBefore && allowed.some(p => p.toLowerCase() === saved.helper.toLowerCase())) throw new Error('Helper permission undo did not verify; the recovery record was kept.')
    if (args.includes('--cloak-off') && (await cliRead(['--cloak-state'])).includes('--cloak-on')) throw new Error('HidHide state undo did not verify; the recovery record was kept.')
    await unlink(routingJournalPath())
    return windowsRoutingState()
  } finally { routingBusy = false }
}
