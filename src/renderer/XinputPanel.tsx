import XinputForwardingControls from './XinputForwardingControls'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PREVIEW, previewStick, readStandardPad, validPreview, type PreviewSettings } from '@shared/xinput'

const SETUP = 'Wooting 60HE → XIM MATRIX → Xbox-compatible Windows input'
const VERSION = '7.00.20260714'
const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Guide']
type Snapshot = NonNullable<ReturnType<typeof readStandardPad>>
function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function initialSettings(): PreviewSettings {
  try { const saved: unknown = JSON.parse(localStorage.getItem('sticklabs.xim.preview.v1') ?? 'null'); if (validPreview(saved)) return saved } catch { /* use defaults */ }
  return { ...DEFAULT_PREVIEW }
}
function StickPlot({ x, y, label }: { x: number; y: number; label: string }): JSX.Element {
  return <div className="stack" style={{ alignItems: 'center' }}>
    <svg viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label={`${label}: X ${x.toFixed(3)}, Y ${y.toFixed(3)}`} style={{ width: '100%', maxWidth: 230, height: 190 }}>
      <circle cx="0" cy="0" r="1" fill="none" stroke="#3a2230" strokeWidth="0.015" />
      <path d="M -1 0 H 1 M 0 -1 V 1" stroke="#3a2230" strokeWidth="0.015" />
      <circle cx={x} cy={y} r="0.055" fill="#f43f52" />
    </svg>
    <span className="mono">{label}: {x.toFixed(3)}, {y.toFixed(3)}</span>
  </div>
}
export default function XinputPanel(): JSX.Element {
  const [pads, setPads] = useState<Array<{ index: number; id: string; standard: boolean }>>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [sample, setSample] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<PreviewSettings>(initialSettings)
  const [range, setRange] = useState<{ min: number[]; max: number[]; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const restingSamples = useRef<number[][]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setSample(null); setRange(null); restingSamples.current = [] }, [selected])
  useEffect(() => {
    const poll = (): void => {
      try {
        const all = Array.from(navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected)
        const list = all.map(p => ({ index: p.index, id: p.id, standard: p.mapping === 'standard' }))
        setPads(old => JSON.stringify(old) === JSON.stringify(list) ? old : list)
        const pad = all.find(p => p.index === selected)
        const value = pad ? readStandardPad(pad) : null
        if (!value) { restingSamples.current = []; setSample(null); return }
        if (paused) return
        restingSamples.current.push(value.axes.slice(0, 2))
        if (restingSamples.current.length > 60) restingSamples.current.shift()
        setSample(value)
        setRange(old => old ? {
          min: old.min.map((v, i) => Math.min(v, value.axes[i])),
          max: old.max.map((v, i) => Math.max(v, value.axes[i])), count: old.count + 1
        } : { min: [...value.axes], max: [...value.axes], count: 1 })
      } catch (e) { setError(`Gamepad access failed: ${(e as Error).message}`); setSample(null) }
    }
    poll()
    const timer = window.setInterval(poll, 33)
    return () => window.clearInterval(timer)
  }, [selected, paused])
  useEffect(() => { try { localStorage.setItem('sticklabs.xim.preview.v1', JSON.stringify(settings)) } catch { setError('Preview settings could not be saved locally.') } }, [settings])
  const left = sample ? previewStick(sample.axes[0], sample.axes[1], settings) : [0, 0]
  const right = sample ? previewStick(sample.axes[2], sample.axes[3], { ...settings, centerX: 0, centerY: 0, rangeX: 1, rangeY: 1 }) : [0, 0]
  const currentPad = pads.find(p => p.index === selected)
  return <div className="stack" style={{ gap: 16 }}>
    <div className="card">
      <h3>Xbox 360 Controller for Windows / XInput</h3>
      <p>Supports standard Xbox-compatible output, including devices Windows labels “Xbox 360 Controller for Windows”.</p>
      <p>{SETUP}. Your reported firmware and Manager version: {VERSION}.</p>
      <div className="hint">Press a key or button on the connected device to make it visible, then select its Windows output. Device names can be generic; this does not identify the hardware automatically.</div>
      <label className="stack" style={{ marginTop: 12 }}>Controller output
        <select className="input" value={selected ?? ''} onChange={e => setSelected(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Select a controller</option>
          {pads.map(p => <option key={p.index} value={p.index} disabled={!p.standard}>#{p.index + 1} · {p.id}{p.standard ? '' : ' — unsupported mapping'}</option>)}
        </select>
      </label>
      {pads.length === 0 && <p>No gamepad output is visible. Connect MATRIX to Windows, enable Xbox-compatible output, focus this window and press a mapped key. Wooting keyboard-only input will not appear here.</p>}
      <p role="status">{sample ? paused ? 'Paused' : 'Receiving standard gamepad input' : 'Waiting for a selected controller’s input'}</p>
      {error && <div className="note bad" role="alert">{error}</div>}
    </div>
    <div className="card">
      <h3>Live output</h3>
      <div className="two"><StickPlot x={sample?.axes[0] ?? 0} y={sample?.axes[1] ?? 0} label="Left" /><StickPlot x={sample?.axes[2] ?? 0} y={sample?.axes[3] ?? 0} label="Right" /></div>
      <div className="row spread"><span>LT: {sample ? `${(sample.triggers[0] * 100).toFixed(1)}%` : '—'}</span><span>RT: {sample ? `${(sample.triggers[1] * 100).toFixed(1)}%` : '—'}</span></div>
      <div className="row wrap" style={{ marginTop: 12 }} aria-label="Controller buttons">{BUTTONS.map((name, i) => <span key={name} className={`pill${sample?.buttons[i] ? ' good' : ''}`}>{name}{sample?.buttons[i] ? ' pressed' : ''}</span>)}</div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => setPaused(v => !v)}>{paused ? 'Resume' : 'Pause'}</button><button className="btn sm" onClick={() => setRange(null)}>Reset ranges</button></div>
      <table className="tbl"><thead><tr><th>Axis</th><th>Minimum</th><th>Maximum</th><th>Span</th></tr></thead><tbody>{['LX', 'LY', 'RX', 'RY'].map((name, i) => <tr key={name}><td>{name}</td><td>{range?.min[i].toFixed(3) ?? '—'}</td><td>{range?.max[i].toFixed(3) ?? '—'}</td><td>{range ? (range.max[i] - range.min[i]).toFixed(3) : '—'}</td></tr>)}</tbody></table>
      <p className="hint">Sampled about 30 times per second. This is browser sampling, not USB polling rate or hardware latency. Values include Wooting, MATRIX and Windows processing.</p>
      <button className="btn sm" disabled={!sample} onClick={() => download('sticklabs-xim-diagnostics.json', { version: 1, setup: SETUP, reportedFirmware: VERSION, reportedManager: VERSION, device: currentPad, capturedAt: new Date().toISOString(), sample, range, previewSettings: settings })}>Export diagnostics</button>
    </div>
    <div className="card">
      <h3>Edit testing settings · local preview</h3>
      <p>Editing changes the plots below. To send these adjustments to games, start Windows forwarding below, then use “Apply edited settings to output” after further edits. Preview presets do not write to hardware.</p>
      <div className="two">{(['inner', 'outer', 'exponent'] as const).map(key => <label className="stack" key={key}>{key === 'inner' ? 'Inner deadzone (%)' : key === 'outer' ? 'Outer saturation (%)' : 'Response exponent'}<input className="input" type="number" min={key === 'exponent' ? 0.2 : key === 'outer' ? settings.inner + 0.1 : 0} max={key === 'exponent' ? 5 : key === 'inner' ? 50 : 100} step={0.1} value={settings[key]} onChange={e => { const next = { ...settings, [key]: Number(e.target.value) }; if (validPreview(next)) setSettings(next) }} /></label>)}</div>
      <div className="row" style={{ marginTop: 12 }}>{(['invertX', 'invertY'] as const).map(key => <label key={key}><input type="checkbox" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} /> {key === 'invertX' ? 'Invert X' : 'Invert Y'}</label>)}</div>
      <h3>Left-stick calibration and analog feel for both sticks</h3>
      <p>Release the stick to capture its center. Then reset ranges and slowly sweep every direction before capturing travel. Calibration is saved in this preset and applies to the left stick only.</p>
      <div className="row wrap">
        <button className="btn sm" disabled={!sample || paused} onClick={() => { if (!sample) return; const samples = restingSamples.current; if (samples.length < 60 || [0, 1].some(i => Math.max(...samples.map(v => v[i])) - Math.min(...samples.map(v => v[i])) > .02)) { setError('Release the left stick and hold it still for two seconds.'); return } const [centerX, centerY] = [0, 1].map(i => samples.reduce((sum, v) => sum + v[i], 0) / samples.length); const next = { ...settings, centerX, centerY }; if (validPreview(next)) { setSettings(next); setError(null) } else setError('Release the left stick; its center must be within 25% of neutral.') }}>Capture resting center</button>
        <button className="btn sm" disabled={!range || range.count < 30} onClick={() => { if (!range) return; const next = { ...settings, rangeX: Math.min(range.max[0] - (settings.centerX ?? 0), (settings.centerX ?? 0) - range.min[0]), rangeY: Math.min(range.max[1] - (settings.centerY ?? 0), (settings.centerY ?? 0) - range.min[1]) }; if (validPreview(next)) { setSettings(next); setError(null) } else setError('Sweep the left stick fully in all four directions first.') }}>Capture full travel</button>
        <button className="btn sm" onClick={() => setSettings(s => ({ ...s, centerX: 0, centerY: 0, rangeX: 1, rangeY: 1 }))}>Reset calibration</button>
      </div>
      <p className="mono">Center {(settings.centerX ?? 0).toFixed(3)}, {(settings.centerY ?? 0).toFixed(3)} · Travel {(settings.rangeX ?? 1).toFixed(3)}, {(settings.rangeY ?? 1).toFixed(3)}</p>
      <label className="stack">Response curve<select className="input" value={settings.exponent} onChange={e => setSettings(s => ({ ...s, exponent: Number(e.target.value) }))}><option value={settings.exponent}>Current ({settings.exponent})</option><option value={1}>Linear</option><option value={1.6}>Precision</option><option value={0.65}>Quick response</option></select></label>
      <svg viewBox="0 0 100 100" width="180" height="180" role="img" aria-label="Response curve: input to output"><path d="M0 0 V100 H100" fill="none" stroke="currentColor" /><polyline fill="none" stroke="#f43f52" strokeWidth="2" points={Array.from({ length: 101 }, (_, i) => { const v = previewStick(i / 100, 0, { ...settings, centerX: 0, centerY: 0, rangeX: 1, rangeY: 1, invertX: false }); return `${i},${100 - v[0] * 100}` }).join(' ')} /></svg>
      <div className="two">
        {([['variation', 'Left-stick jitter', 'leftJitterAlways'], ['rightVariation', 'Right-stick jitter', 'rightJitterAlways']] as const).map(([key, label, mode]) => <div className="stack" key={key}><label className="stack">{label}: {(settings[key] ?? 0).toFixed(1)}%
          <input type="range" min="0" max="5" step="0.1" value={settings[key] ?? 0} onChange={e => { const next = { ...settings, [key]: Number(e.target.value) }; if (validPreview(next)) setSettings(next) }} />
        </label><label><input type="checkbox" checked={settings[mode] ?? false} onChange={e => setSettings(s => ({ ...s, [mode]: e.target.checked }))} /> Always on, including at rest</label></div>)}
        <label className="stack">Jitter speed (changes per second)<input className="input" type="number" min="0.2" max="60" step="0.1" value={settings.variationSpeed ?? 1} onChange={e => { const next = { ...settings, variationSpeed: Number(e.target.value) }; if (validPreview(next)) setSettings(next) }} /></label>
      </div>
      <div className="row wrap" style={{ marginTop: 12 }} aria-label="Jitter speed presets">{([[1, 'Slow'], [8, 'Quick'], [16, 'Fast'], [32, 'Very fast']] as const).map(([rate, label]) => <button className="btn sm" key={rate} aria-pressed={(settings.variationSpeed ?? 1) === rate} onClick={() => setSettings(s => ({ ...s, variationSpeed: rate }))}>{label} · {rate}/s</button>)}</div>
      <p className="hint">Speed controls how often jitter chooses a new direction and strength; the left/right percentages control its size. For quicker jitter, try Fast (16/s) with your existing strength, then adjust the speed. This rate is separate from USB polling and does not add a filter to the underlying stick input. After editing while forwarding, click Apply edited settings to output.</p>
      <p className="hint">Jitter smoothly changes angle and strength independently on each stick while it is pressed. Zero disables it. Normally release returns to exact neutral; Always on continues jitter at rest and can move your character or camera. Stop forwarding to release all input. The plots show the base curve; variation runs in the Windows output. Start around 0.5–1%. This adds texture but cannot create pressure sensitivity from digital keys.</p>
      <div className="two"><StickPlot x={left[0]} y={left[1]} label="Preview left" /><StickPlot x={right[0]} y={right[1]} label="Preview right" /></div>
      <div className="row wrap"><button className="btn sm" onClick={() => setSettings({ ...DEFAULT_PREVIEW })}>Reset preview</button><button className="btn sm" onClick={() => download('sticklabs-xim-preview.json', { app: 'sticklabs-xim-preview', version: 1, settings })}>Export preview preset</button><button className="btn sm" onClick={() => fileRef.current?.click()}>Import preview preset</button></div>
      <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
        if (file.size > 65536) { setError('Preset is too large (maximum 64 KB).'); return }
        void file.text().then(text => { const data = JSON.parse(text); if (data.app !== 'sticklabs-xim-preview' || data.version !== 1 || !validPreview(data.settings)) throw new Error('Not a valid Stick Labs preview preset'); setSettings(data.settings); setError(null) }).catch(err => setError((err as Error).message))
      }} />
    </div>
    <XinputForwardingControls settings={settings} />
    <div className="card">
      <h3>Editing the actual MATRIX and Wooting settings</h3>
      <p>Use XIM MATRIX Manager {VERSION} to edit and save the adapter’s configuration. Use Wootility for the keyboard’s analog configuration. Stick Labs does not yet have a verified MATRIX configuration protocol for this firmware.</p>
      <p>Onboard profiles, backup/restore, hardware calibration, polling-rate switching, sensor bit depth and device curve writes are unavailable here. Importing a preview preset is not importing a MATRIX configuration.</p>
    </div>
  </div>
}
