import { useState } from 'react'
import { api } from './api'
import type { RoutingState } from '@shared/hidHideRouting'
export default function HidHideRoutingControls(): JSX.Element {
  const [state, setState] = useState<RoutingState | null>(null)
  const [selected, setSelected] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError(null)
    try { await action() } catch (e) { setError((e as Error).message); try { setState(await api().windowsRoutingState()) } catch { /* keep existing state if driver is unavailable */ } } finally { setBusy(false) }
  }
  return <div className="stack" style={{ gap: 10, marginTop: 16 }}>
    <h4>Guided MATRIX routing</h4>
    <p>1. Install HidHide above and restart if requested. 2. Scan and select the MATRIX gamepad interface. 3. Apply routing, then refresh Windows XInput slots below.</p>
    <button className="btn sm" disabled={busy} onClick={() => void perform(async () => {
      const result = await api().windowsRoutingState(); setState(result)
      const recommended = result.devices.filter(d => d.recommended)
      if (recommended.length === 1) setSelected(recommended[0].id)
      setConfirmed(false); setMessage(null)
    })}>{busy ? 'Working…' : 'Scan routing devices'}</button>
    {state && <>
      <label className="stack">Gamepad interface to route
        <select className="input" value={selected} disabled={busy || !!state.configuredDevice} onChange={e => { setSelected(e.target.value); setConfirmed(false) }}>
          <option value="">Choose the MATRIX output</option>
          {state.devices.map(d => <option key={d.id} value={d.id}>{d.recommended ? 'MATRIX output match · ' : ''}{d.name} · {d.id}</option>)}
        </select>
      </label>
      {!state.devices.length && <p>No supported gamepad interface was found. Connect MATRIX and rescan. Keyboard/mouse interfaces and identified ViGEm devices are excluded.</p>}
      <p>This allows only the bundled forwarding helper to read the selected gamepad and hides that interface from games. Existing HidHide rules are preserved. {state.hiddenCount > 0 && !state.active ? `Enabling HidHide also activates ${state.hiddenCount} existing hidden-device rule(s).` : ''}</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy || !!state.configuredDevice} onChange={e => setConfirmed(e.target.checked)} /> This is my MATRIX gamepad interface; enable routing for it.</label>
      <div className="row wrap">
        <button className="btn sm primary" disabled={busy || !selected || !confirmed || !!state.configuredDevice} onClick={() => void perform(async () => {
          setState(await api().windowsApplyRouting(selected)); setMessage('Routing verified. Reconnect MATRIX if needed, then refresh Windows XInput slots and choose its source. The original may disappear from the browser controller list; the allowed helper can still read it.')
        })}>Set up routing</button>
        <button className="btn sm" disabled={busy || !state.configuredDevice} onClick={() => void perform(async () => {
          setState(await api().windowsUndoRouting()); setConfirmed(false); setMessage('Stick Labs routing changes were undone. Pre-existing and subsequently added rules are preserved.')
        })}>Undo Stick Labs routing</button>
      </div>
      {state.configuredDevice && <p className="hint">A routing recovery record exists for {state.configuredDevice}. Undo remains available even if setup was interrupted.</p>}
    </>}
    {message && <p role="status">{message}</p>}{error && <div className="note bad" role="alert">{error}</div>}
  </div>
}
