import assert from 'node:assert/strict'
import { cliEntries, safeRoutingDevice } from '../src/shared/hidHideRouting'
const id = 'USB\\VID_046D&PID_C53B&MI_00\\7&ABC&0000'
assert.deepEqual(safeRoutingDevice({ id, service: 'xusb22', name: 'Xbox 360 Controller for Windows' }), { id, name: 'Xbox 360 Controller for Windows', recommended: true })
assert.equal(safeRoutingDevice({ id: 'USB\\KEYBOARD', service: 'kbdhid' }), null)
assert.equal(safeRoutingDevice({ id: 'HID\\MOUSE', service: 'mouhid' }), null)
assert.equal(safeRoutingDevice({ id: 'ROOT\\VIGEMBUS\\0', service: 'xusb22' }), null)
assert.equal(safeRoutingDevice({ id, service: 'xusb22', parent: 'ROOT\\VIGEMBUS\\0000' }), null)
assert.equal(safeRoutingDevice({ id: id + '\n', service: 'xusb22' }), null)
assert.equal(safeRoutingDevice({ id: 'USB\\container', service: 'usbccgp' }), null)
assert.equal(safeRoutingDevice({ id: 'HID\\VID_1234&PID_5678', gaming: true })?.recommended, false)
assert.deepEqual(cliEntries(`--app-reg "C:\\Program Files\\Stick Labs\\xinputbridge.exe"\n--app-reg "C:\\Other.exe"\nnot a command`, 'app-reg'), ['C:\\Program Files\\Stick Labs\\xinputbridge.exe', 'C:\\Other.exe'])
assert.deepEqual(cliEntries(`--dev-hide "${id}"\n--app-reg "C:\\foo.exe"`, 'dev-hide'), [id])
console.log('HidHide device filtering and command parsing passed.')
