import importlib.util
from pathlib import Path
import time
import unittest

spec = importlib.util.spec_from_file_location('xinputbridge', Path(__file__).resolve().parents[1] / 'scripts' / 'xinputbridge.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
DEFAULT = dict(inner=0, outer=100, exponent=1, invertX=False, invertY=False)

class Target:
    def __init__(self, slot=1):
        self.slot = slot
        self.closed = False
        self.writes = []
    def user_index(self):
        return self.slot
    def write(self, *report):
        self.writes.append(report)
    def close(self):
        self.closed = True

class Tests(unittest.TestCase):
    def test_axis_endpoints_and_y_convention(self):
        self.assertEqual(m.transform_stick(-32768, 0, DEFAULT), (-32768, 0))
        self.assertEqual(m.transform_stick(32767, 0, DEFAULT), (32767, 0))
        self.assertEqual(m.transform_stick(0, 32767, DEFAULT), (0, 32767))
        self.assertEqual(m.transform_stick(0, -32768, dict(DEFAULT, invertY=True)), (0, 32767))
    def test_shape_and_deadzone(self):
        self.assertEqual(m.transform_stick(1000, -1000, dict(DEFAULT, inner=10)), (0, 0))
        x, y = m.transform_stick(16384, 0, dict(DEFAULT, inner=10, outer=90, exponent=2))
        self.assertAlmostEqual(x, 8193, delta=1)
        self.assertEqual(y, 0)
    def test_validation(self):
        for settings in (dict(DEFAULT, outer=0), dict(DEFAULT, exponent=float('nan')), dict(DEFAULT, invertX=1), dict(DEFAULT, inner=True)):
            with self.assertRaises(ValueError): m.validate_settings(settings)
    def test_passthrough_disconnect_and_no_reconnect(self):
        state = m.Gamepad(buttons=0x1001, lt=45, rt=255, lx=32767, ly=0, rx=0, ry=-32768)
        devices = {0: state}
        target = Target()
        bridge = m.Bridge(devices.get, lambda: target)
        bridge.start(0, DEFAULT)
        bridge.tick()
        self.assertEqual(target.writes[-1], (0x1001, 45, 255, 32767, 0, 0, -32768))
        self.assertEqual(bridge.status()['outputSlot'], 1)
        devices.clear(); bridge.tick()
        self.assertTrue(target.closed)
        self.assertFalse(bridge.status()['running'])
        devices[0] = state; bridge.tick()
        self.assertEqual(len(target.writes), 1)
    def test_refuse_virtual_feedback(self):
        target = Target(0)
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        with self.assertRaises(ValueError): bridge.start(0, DEFAULT)
        self.assertTrue(target.closed)
        self.assertFalse(bridge.status()['running'])
    def test_full_xinput_slots(self):
        bridge = m.Bridge(lambda slot: m.Gamepad(), lambda: self.fail('Must not allocate virtual target'))
        with self.assertRaises(ValueError): bridge.start(0, DEFAULT)
    def test_watchdog_releases_and_source_not_auto_selected(self):
        target = Target()
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        with self.assertRaises(ValueError): bridge.start(2, DEFAULT)
        bridge.start(0, DEFAULT)
        bridge.last_heartbeat = time.monotonic() - 6
        bridge.tick()
        self.assertTrue(target.closed)
        self.assertIn('timed out', bridge.error)
    def test_explicit_stop(self):
        target = Target()
        bridge = m.Bridge(lambda slot: m.Gamepad() if slot == 0 else None, lambda: target)
        bridge.start(0, DEFAULT); bridge.stop(); bridge.stop()
        self.assertTrue(target.closed)
        self.assertEqual(bridge.status()['sourceSlot'], None)
    def test_windows_target_neutral_before_removal(self):
        events = []
        class Pad:
            def reset(self): events.append('neutral')
            def update(self): events.append('publish')
            def __del__(self): events.append('remove')
        target = m.WindowsTarget.__new__(m.WindowsTarget)
        target.pad = Pad()
        target.close()
        self.assertEqual(events, ['neutral', 'publish', 'remove'])
        target.close()
        self.assertEqual(len(events), 3)

    def test_virtual_slot_not_listed_as_source(self):
        devices = {0: m.Gamepad()}
        target = Target()
        bridge = m.Bridge(devices.get, lambda: target)
        bridge.start(0, DEFAULT); devices[1] = m.Gamepad()
        self.assertEqual([s['slot'] for s in bridge.sources()], [0])

if __name__ == '__main__': unittest.main()
