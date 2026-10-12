import { useEffect, useState } from 'react'
import { api } from './api'
import type { PreviewSettings } from '@shared/xinput'
import type { ForwardingStatus, XinputSource } from '@shared/xinputForwarding'

export default function XinputForwardingControls({ settings }: { settings: PreviewSettings }): JSX.Element {
  const [status, setStatus] = useState<ForwardingStatus | null>(null)
  const [sources, setSources] = useState<XinputSource[]>([])
  const [source, setSource] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const [routingConfirmed, setRoutingConfirmed] = useState(false)
  useEffect(() => {
    let dead = false
    const poll = (): void => { void api().xinputStatus().then(s => { if (!dead) setStatus(s) }).catch(e => { if (!dead) setError(e.message) }) }
    poll(); const timer = window.setInterval(poll, 1000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [])
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError(null)
    try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const changed = applied !== JSON.stringify(settings)
  return <div className="card">
    <h3>Forward adjusted input to Windows games</h3>
    <p>Creates a virtual Xbox 360 controller using the settings above. Both sticks are adjusted; buttons and triggers pass through. Keep Stick Labs running. This does not write to MATRIX or Wooting.</p>
    <p>Windows releases include the input helper and its libraries. Install the signed ViGEmBus driver once using the button below; Windows will request administrator approval. This Windows backend is experimental and has not been tested with your hardware. ViGEmBus is a retired upstream project.</p>
    <button className="btn sm" disabled={!status?.supported || busy || !!status?.running} onClick={() => void perform(async () => { await api().xinputInstallDriver(); setSetupMessage('Driver setup finished. Restart Windows if requested, then reopen Stick Labs.') })}>{busy ? 'Working…' : 'Install / repair Windows driver'}</button>
    {setupMessage && <p role="status">{setupMessage}</p>}
    {!status?.supported && <div className="note" role="status">{status?.error ?? 'Checking Windows support…'}</div>}
    <div className="row wrap">
      <button className="btn sm" disabled={!status?.supported || busy || status.running} onClick={() => void perform(async () => { setSources(await api().xinputSources()) })}>Refresh Windows XInput slots</button>
      <label>Source slot <select className="input" value={source ?? ''} disabled={busy || !!status?.running} onChange={e => { setSource(e.target.value === '' ? null : Number(e.target.value)); setRoutingConfirmed(false) }}>
        <option value="">Choose the MATRIX output</option>
        {sources.map(s => <option key={s.slot} value={s.slot}>Slot {s.slot + 1} · LX {s.lx}, LY {s.ly} · LT {s.lt}, RT {s.rt}</option>)}
      </select></label>
    </div>
    <p className="hint">Windows XInput slots are separate from the browser controller list. Move a mapped analog key and refresh to identify the correct source. Connect the source first; do not select another app’s virtual output.</p>
    <p>Games must read the virtual controller rather than the original output. For games that cannot choose a controller, use HidHide to hide the MATRIX gamepad interface from games and allow the bundled sticklabs-xinput.exe helper to read it. Do not hide keyboard or mouse interfaces. This app does not change device visibility automatically.</p>
    <label><input type="checkbox" checked={routingConfirmed} disabled={busy || !!status?.running} onChange={e => setRoutingConfirmed(e.target.checked)} /> I have selected the source and configured my game to use the virtual controller.</label>
    <div className="row wrap" style={{ marginTop: 12 }}>
      <button className="btn sm primary" disabled={!status?.supported || busy || source === null || !routingConfirmed || !!status?.running} onClick={() => void perform(async () => {
        setStatus(await api().xinputStart(source!, settings)); setApplied(JSON.stringify(settings))
      })}>Start forwarding</button>
      <button className="btn sm" disabled={busy || !status?.running || !changed} onClick={() => void perform(async () => { await api().xinputSettings(settings); setApplied(JSON.stringify(settings)) })}>Apply edited settings to output</button>
      <button className="btn sm" disabled={busy || !status?.running} onClick={() => void perform(async () => { setStatus(await api().xinputStop()); setApplied(null) })}>Stop forwarding</button>
    </div>
    <p role="status">{status?.running ? `Forwarding slot ${(status.sourceSlot ?? 0) + 1} → virtual slot ${(status.outputSlot ?? 0) + 1}${changed ? ' · preview changes are not yet applied' : ''}` : 'Forwarding stopped'}</p>
    <p className="hint">Source disconnect or loss of the helper connection stops forwarding and releases input. Leave other controllers disconnected during use to avoid slot reassignment. USB polling-rate and hardware bit-depth settings remain unchanged. Rumble/force feedback is not forwarded to the source.</p>
    {(error || status?.error) && status?.supported && <div className="note bad" role="alert">{error || status?.error}</div>}
  </div>
}
