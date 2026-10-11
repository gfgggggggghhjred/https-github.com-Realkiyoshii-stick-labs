import assert from 'node:assert/strict'
import { DEFAULT_PREVIEW, previewStick, readStandardPad, validPreview } from '../src/shared/xinput'
const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }))
buttons[6] = { value: 0.25, pressed: false }; buttons[7] = { value: 0.75, pressed: true }
const pad = { connected: true, mapping: 'standard', axes: [-1, 0, 0.5, 1], buttons }
assert.deepEqual(readStandardPad(pad), { axes: [-1, 0, 0.5, 1], triggers: [0.25, 0.75], buttons: buttons.map(b => b.pressed) })
assert.equal(readStandardPad({ ...pad, mapping: '' }), null)
assert.equal(readStandardPad({ ...pad, connected: false }), null)
assert.equal(readStandardPad({ ...pad, axes: [0, 0] }), null)
assert.equal(readStandardPad({ ...pad, buttons: [] }), null)
assert.equal(readStandardPad({ ...pad, axes: [NaN, 0, 0, 0] }), null)
assert.deepEqual(previewStick(0, 0, DEFAULT_PREVIEW), [0, 0])
assert.deepEqual(previewStick(0.3, 0.4, DEFAULT_PREVIEW), [0.3, 0.4])
assert.deepEqual(previewStick(0.05, 0, { ...DEFAULT_PREVIEW, inner: 10 }), [0, 0])
const shaped = previewStick(0.5, 0, { ...DEFAULT_PREVIEW, inner: 10, outer: 90, exponent: 2 })
assert.ok(Math.abs(shaped[0] - 0.25) < 1e-10)
assert.equal(previewStick(1, 0, { ...DEFAULT_PREVIEW, invertX: true })[0], -1)
assert.ok(Math.abs(Math.hypot(...previewStick(1, 1, DEFAULT_PREVIEW)) - 1) < 1e-10)
assert.equal(validPreview({ ...DEFAULT_PREVIEW, outer: 0 }), false)
assert.equal(validPreview({ ...DEFAULT_PREVIEW, inner: NaN }), false)
assert.equal(validPreview({ ...DEFAULT_PREVIEW, exponent: Infinity }), false)
assert.equal(validPreview({ ...DEFAULT_PREVIEW, invertX: 'false' }), false)
assert.throws(() => previewStick(0, 0, { ...DEFAULT_PREVIEW, exponent: 0 }))
console.log('XInput mapping, triggers, invalid data, deadzones, curves, inversion and preset validation passed (18 checks).')
