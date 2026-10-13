import { useEffect, useState } from 'react'
import { api } from './api'
import type { RoutingState } from '@shared/hidHideRouting'
export default function HidHideRoutingControls({ scanRequest, disabled, onConnected, onBusyChange }: { scanRequest: number; disabled: boolean; onConnected: () => Promise<void>; onBusyChange: (busy: boolean) => void }): JSX.Element {
  const [state, setState] = useState<RoutingState | null>(null)
  const [selected, setSelected] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  async function scan(): Promise<void> {
    const result = await api().windowsRoutingState(); setState(result)
    const recommended = result.devices.filter(d => d.recommended)
    setSelected(recommended.length === 1 ? recommended[0].id : '')
    setConfirmed(false); setMessage(null)
  }
  useEffect(() => { if (scanRequest > 0) void perform(scan) }, [scanRequest])
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError(null)
    try { await action() } catch (e) { setError((e as Error).message); try { setState(await api().windowsRoutingState()) } catch { /* keep existing state if driver is unavailable */ } } finally { setBusy(false) }
  }
  return <div className="stack" style={{ gap: 10, marginTop: 16 }}>
    <h4>Guided MATRIX routing</h4>
    <p>1. Install HidHide above and restart if requested. 2. Scan and select the MATRIX gamepad interface. 3. Confirm and apply routing to launch the helper and refresh Windows XInput slots below.</p>
    <button className="btn sm" disabled={disabled || busy} onClick={() => void perform(scan)}>{busy ? 'Working…' : 'Scan routing devices'}</button>
    {state && <>
      <label className="stack">Gamepad interface to route
        <select className="input" value={selected} disabled={disabled || busy || !!state.configuredDevice} onChange={e => { setSelected(e.target.value); setConfirmed(false) }}>
          <option value="">Choose the MATRIX output</option>
          {state.devices.map(d => <option key={d.id} value={d.id}>{d.recommended ? 'MATRIX output match · ' : ''}{d.name} · {d.id}</option>)}
        </select>
      </label>
      {!state.devices.length && <p>No supported gamepad interface was found. Connect MATRIX and rescan. Keyboard/mouse interfaces and identified ViGEm devices are excluded.</p>}
      <p>This allows only the bundled forwarding helper to read the selected gamepad and hides that interface from games. Existing HidHide rules are preserved. {state.hiddenCount > 0 && !state.active ? `Enabling HidHide also activates ${state.hiddenCount} existing hidden-device rule(s).` : ''}</p>
      <label><input type="checkbox" checked={confirmed} disabled={disabled || busy || !!state.configuredDevice} onChange={e => setConfirmed(e.target.checked)} /> This is my MATRIX gamepad interface; enable routing for it.</label>
      <div className="row wrap">
        <button className="btn sm primary" disabled={disabled || busy || !selected || !confirmed || !!state.configuredDevice} onClick={() => void perform(async () => {
          setState(await api().windowsApplyRouting(selected)); await onConnected(); setMessage('Routing verified and the helper launched. Choose the Windows source slot below and start forwarding. Reconnect MATRIX and refresh if no source appears. The original may disappear from the browser controller list; the allowed helper can still read it.')
        })}>Set up routing</button>
        <button className="btn sm" disabled={disabled || busy || !state.configuredDevice} onClick={() => void perform(onConnected)}>Launch helper & refresh slots</button>
        <button className="btn sm" disabled={disabled || busy || !state.configuredDevice} onClick={() => void perform(async () => {
          setState(await api().windowsUndoRouting()); setConfirmed(false); setMessage('Stick Labs routing changes were undone. Pre-existing and subsequently added rules are preserved.')
        })}>Undo Stick Labs routing</button>
      </div>
      {state.configuredDevice && <p className="hint">A routing recovery record exists for {state.configuredDevice}. Undo remains available even if setup was interrupted.</p>}
    </>}
    {message && <p role="status">{message}</p>}{error && <div className="note bad" role="alert">{error}</div>}
  </div>
}
