import React from 'react'
import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import XinputForwardingControls from '../src/renderer/XinputForwardingControls'
import { DEFAULT_PREVIEW } from '../src/shared/xinput'

let scanCalls = 0
let failScan = false
let pendingScan: Promise<void> | null = null
let failOpen = false
let running = true
let prepared = false
let installed = true
const installs: string[] = []
const routing = { devices: [{ id: 'USB\\VID_046D&PID_C53B', name: 'MATRIX', recommended: true }], active: false, hiddenCount: 0, configuredDevice: null }
;(globalThis as any).window = {
  setInterval: () => 1, clearInterval: () => undefined,
  sticklab: {
    xinputStatus: async () => ({ supported: true, running, prepared }),
    xinputPrepare: async () => { prepared = true; return { supported: true, running: false, prepared: true, outputSlot: 0 } },
    xinputStop: async () => { prepared = false; return { supported: true, running: false, prepared: false } },
    windowsSetupStatus: async () => ({ supported: true, bundled: true, vigemInstalled: installed || installs.includes('vigem'), hidHideInstalled: installed || installs.includes('hidhide') }),
    windowsInstallDriver: async (driver: string) => { installs.push(driver); return { rebootRequired: false } },
    windowsRoutingState: async () => { scanCalls++; if (pendingScan) await pendingScan; if (failScan) throw new Error('Scan could not read HidHide'); return routing },
    windowsApplyRouting: async () => { throw new Error('Routing approval was cancelled') },
    windowsUndoRouting: async () => routing,
    windowsOpenRouting: async () => { if (failOpen) throw new Error('HidHide client is missing'); return 'C:\\Program Files\\Nefarius Software Solutions\\HidHide\\x64\\HidHideClient.exe' }
  }
}
let view: ReactTestRenderer
await act(async () => { view = create(<XinputForwardingControls settings={DEFAULT_PREVIEW} />) })
const button = (label: string) => view.root.findAllByType('button').find(b => b.children.join('') === label)!
const text = () => JSON.stringify(view.toJSON())
async function click(label: string): Promise<void> {
  const target = button(label)
  assert.ok(target, `Missing button: ${label}`)
  assert.ok(!target.props.disabled, `Disabled button: ${label}`)
  await act(async () => { target.props.onClick(); await Promise.resolve() })
}
assert.ok(button('Connect & set up').props.disabled)
assert.match(text(), /Stop forwarding below/)
await click('Check setup again')
assert.match(text(), /Setup checked at/)
await click('Open advanced HidHide application')
assert.match(text(), /HidHide launch requested/)
let finishScan: () => void
pendingScan = new Promise<void>(resolve => { finishScan = resolve })
await click('Scan routing devices')
assert.match(text(), /Scanning connected gamepad/)
assert.ok(!button('Stop forwarding').props.disabled, 'Stop must stay available during a read-only scan')
await act(async () => { finishScan(); pendingScan = null; await Promise.resolve() })
assert.match(text(), /Scan complete: 1/)
assert.ok(button('Set up routing').props.disabled)
failScan = true
const previous = scanCalls
await click('Scan routing devices')
assert.equal(scanCalls, previous + 1, 'A failed scan must not silently run another scan')
assert.match(text(), /Scan could not read HidHide/)
assert.ok(!button('Check setup again').props.disabled, 'A failed scan must release the setup controls')
failOpen = true
await click('Open advanced HidHide application')
assert.match(text(), /HidHide client is missing/)
await act(async () => view.unmount())

// Guided install must finish, automatically scan, and release its busy state.
running = false; installed = false; failScan = false
await act(async () => { view = create(<XinputForwardingControls settings={DEFAULT_PREVIEW} />) })
await click('Connect & set up')
assert.deepEqual(installs, ['vigem', 'hidhide'])
assert.match(text(), /Scan complete: 1/)
assert.ok(!button('Connect & set up').props.disabled)
assert.ok(!button('Scan routing devices').props.disabled)
const confirmation = view.root.findAllByType('label').find(label => label.children.some(child => typeof child === 'string' && child.includes('This is my MATRIX')))!
await act(async () => confirmation.findByType('input').props.onChange({ target: { checked: true } }))
await click('Set up routing')
assert.match(text(), /Routing approval was cancelled/)
assert.ok(!button('Undo Stick Labs routing').props.disabled, 'Undo must remain available after a partial routing failure')
await click('Undo Stick Labs routing')
assert.match(text(), /routing changes were undone/)
await click('Prepare virtual controller as Player 1')
assert.match(text(), /Virtual controller verified in Windows slot 1/)
assert.ok(button('Start forwarding').props.disabled)
await click('Cancel Player 1 reservation')
assert.ok(!button('Prepare virtual controller as Player 1').props.disabled)
await act(async () => view.unmount())
console.log('Windows setup UI: active forwarding, launch feedback, scan failure recovery, and guided setup passed.')

// React's test scheduler keeps a MessageChannel open after unmount.
process.exit(0)
