import HidHideRoutingControls from './HidHideRoutingControls'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { WindowsDriver, WindowsSetupStatus } from '@shared/windowsSetup'
export default function WindowsSetupControls(): JSX.Element {
  const [status, setStatus] = useState<WindowsSetupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function refresh(): Promise<void> { setStatus(await api().windowsSetupStatus()) }
  useEffect(() => { void refresh().catch(e => setError(e.message)) }, [])
  async function install(driver: WindowsDriver): Promise<void> {
    setBusy(true); setError(null); setMessage('Complete the Windows administrator prompt and driver installer.')
    try {
      const result = await api().windowsInstallDriver(driver)
      await refresh()
      setMessage(result.rebootRequired ? 'Restart Windows to finish driver setup, then open Stick Labs again.' : 'Installer finished. If it requested a restart, restart Windows before forwarding.')
    } catch (e) { setError((e as Error).message); setMessage(null) } finally { setBusy(false) }
  }
  return <div className="card">
    <h3>Windows forwarding setup</h3>
    <p>Windows downloads include the forwarding runtime. No separate Python or pip installation is needed for Xbox forwarding.</p>
    {status?.supported ? <>
      <div className="row wrap"><span className="pill">Runtime: {status.bundled ? 'bundled' : 'not bundled in this development build'}</span><span className="pill">Virtual driver: {status.vigemInstalled ? 'installed' : 'not installed'}</span><span className="pill">HidHide: {status.hidHideInstalled ? 'installed' : 'optional'}</span></div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn sm primary" disabled={busy || !status.bundled || status.vigemInstalled} onClick={() => void install('vigem')}>Install virtual controller driver</button>
        <button className="btn sm" disabled={busy || !status.bundled || status.hidHideInstalled} onClick={() => void install('hidhide')}>Install optional HidHide</button>
        <button className="btn sm" disabled={busy || !status.hidHideInstalled} onClick={() => void api().windowsOpenRouting().catch(e => setError(e.message))}>Open device routing setup</button>
        <button className="btn sm" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Check setup again</button>
      </div>
      <p className="hint">Windows will ask for administrator approval to install drivers. A restart may be required. Existing driver installations are reused. HidHide setup also installs the included Microsoft runtime if it is missing.</p>
      <p>Advanced setup can also allow this helper executable: <span className="mono">resources/windows-runtime/xinputbridge/xinputbridge.exe</span> inside your Stick Labs installation. Hide only the MATRIX gamepad interface from games. Keep keyboard and mouse interfaces visible. The app does not hide devices automatically.</p>
    </> : <p>Driver setup is available in the Windows application.</p>}
    {status?.supported && status.hidHideInstalled && <HidHideRoutingControls />}
    {message && <p role="status">{message}</p>}{error && <div className="note bad" role="alert">{error}</div>}
  </div>
}
