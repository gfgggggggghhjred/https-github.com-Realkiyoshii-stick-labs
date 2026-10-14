import HidHideRoutingControls from './HidHideRoutingControls'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { WindowsDriver, WindowsSetupStatus } from '@shared/windowsSetup'
export default function WindowsSetupControls({ disabled = false, onConnected, onBusyChange }: { disabled?: boolean; onConnected: () => Promise<void>; onBusyChange: (busy: boolean) => void }): JSX.Element {
  const [status, setStatus] = useState<WindowsSetupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanRequest, setScanRequest] = useState(0)
  const [routingBusy, setRoutingBusy] = useState(false)
  useEffect(() => { onBusyChange(busy || routingBusy); return () => onBusyChange(false) }, [busy, routingBusy, onBusyChange])
  async function refresh(): Promise<void> { setStatus(await api().windowsSetupStatus()) }
  async function checkSetup(): Promise<void> {
    setBusy(true); setError(null); setMessage('Checking installed Windows drivers…')
    try {
      await refresh()
      setMessage(`Setup checked at ${new Date().toLocaleTimeString()}. Driver status is shown above.`)
    } catch (e) { setError((e as Error).message); setMessage(null) } finally { setBusy(false) }
  }
  async function openAdvanced(): Promise<void> {
    setBusy(true); setError(null); setMessage('Opening HidHide Configuration Client…')
    try {
      const path = await api().windowsOpenRouting()
      setMessage(`HidHide launch requested: ${path}. Check the taskbar or Alt+Tab if its window is behind Stick Labs.`)
    } catch (e) { setError((e as Error).message); setMessage(null) } finally { setBusy(false) }
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)) }, [])
  async function install(driver: WindowsDriver): Promise<void> {
    setBusy(true); setError(null); setMessage('Complete the Windows administrator prompt and driver installer.')
    try {
      const result = await api().windowsInstallDriver(driver)
      await refresh()
      setMessage(result.rebootRequired ? 'Restart Windows to finish driver setup, then open Stick Labs again.' : 'Installer finished. If it requested a restart, restart Windows before forwarding.')
    } catch (e) { setError((e as Error).message); setMessage(null) } finally { setBusy(false) }
  }
  async function connectAndSetUp(): Promise<void> {
    setBusy(true); setError(null); setMessage('Checking Windows setup…')
    try {
      let current = await api().windowsSetupStatus()
      setStatus(current)
      if (!current.supported || !current.bundled) throw new Error('Use the installed Windows version of Stick Labs for guided setup.')
      for (const driver of ['vigem', 'hidhide'] as const) {
        if (driver === 'vigem' ? current.vigemInstalled : current.hidHideInstalled) continue
        setMessage(`Opening ${driver === 'vigem' ? 'virtual controller' : 'HidHide'} setup. Complete the Windows administrator prompt and installer.`)
        const result = await api().windowsInstallDriver(driver)
        current = await api().windowsSetupStatus(); setStatus(current)
        if (result.rebootRequired) {
          setMessage('Restart Windows to finish driver setup, then click Connect & set up again.'); return
        }
        if (!(driver === 'vigem' ? current.vigemInstalled : current.hidHideInstalled)) throw new Error('The driver is not installed yet. Finish its installer and restart Windows if requested, then retry.')
      }
      setScanRequest(value => value + 1)
      setMessage('Drivers are ready. Confirm the MATRIX gamepad below and apply routing. The forwarding helper will then open automatically.')
    } catch (e) { setError((e as Error).message); setMessage(null) } finally { setBusy(false) }
  }
  return <div className="card">
    <h3>Windows forwarding setup</h3>
    <p>Windows downloads include the forwarding runtime. No separate Python or pip installation is needed for Xbox forwarding.</p>
    {status?.supported ? <>
      <div className="row wrap"><span className="pill">Runtime: {status.bundled ? 'bundled' : 'not bundled in this development build'}</span><span className="pill">Virtual driver: {status.vigemInstalled ? 'installed' : 'not installed'}</span><span className="pill">HidHide: {status.hidHideInstalled ? 'installed' : 'optional'}</span></div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={disabled || routingBusy || busy || !status.bundled} onClick={() => void connectAndSetUp()}>{busy ? 'Setting up…' : 'Connect & set up'}</button>
        <button className="btn sm primary" disabled={disabled || routingBusy || busy || !status.bundled || status.vigemInstalled} onClick={() => void install('vigem')}>Install virtual controller driver</button>
        <button className="btn sm" disabled={disabled || routingBusy || busy || !status.bundled} onClick={() => void install('hidhide')}>Install / repair HidHide</button>
        <button className="btn sm" disabled={routingBusy || busy} onClick={() => void openAdvanced()}>Open advanced HidHide application</button>
        <button className="btn sm" disabled={routingBusy || busy} onClick={() => void checkSetup()}>Check setup again</button>
      </div>
      {disabled && <p className="note" role="status">Stop forwarding below (or cancel the Player 1 reservation) and wait for any controller operation to finish before installing drivers or applying routing. You can still check setup, scan devices, and open HidHide. Stop forwarding before making changes in the HidHide application.</p>}
      {message && <p role="status">{message}</p>}{error && <div className="note bad" role="alert">{error}</div>}
      <p className="hint">Windows will ask for administrator approval to install drivers. A restart may be required. Existing driver installations are reused. HidHide setup also installs the included Microsoft runtime if it is missing.</p>
      <p>Advanced setup can also allow this helper executable: <span className="mono">resources/windows-runtime/xinputbridge/xinputbridge.exe</span> inside your Stick Labs installation. Hide only the MATRIX gamepad interface from games. Keep keyboard and mouse interfaces visible. Guided setup asks you to confirm the interface before hiding it. Wootility and MATRIX Manager remain available for hardware settings; they are not required to run forwarding.</p>
    </> : <p>Driver setup is available in the Windows application.</p>}
    {status?.supported && status.hidHideInstalled && <HidHideRoutingControls scanRequest={scanRequest} disabled={disabled} scanningDisabled={busy} onConnected={onConnected} onBusyChange={setRoutingBusy} />}
    {!status?.supported && error && <div className="note bad" role="alert">{error}</div>}
  </div>
}
