import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/core/InputManager.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const hidSource = await readFile(new URL('../src/core/PowerAGamepad.ts', import.meta.url), 'utf8');
const hidCode = ts.transpileModule(hidSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(hid) {
  let now = 1000;
  class Clock extends Date { static now() { return now; } }
  const listeners = new Map();
  const document = { hasFocus: () => true, hidden: false };
  const navigator = { getGamepads: () => [], hid };
  const hidExports = {};
  vm.runInNewContext(hidCode, { exports: hidExports, navigator, Date: Clock });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, document, navigator,
    require: () => hidExports,
    window: {
      addEventListener: (name, cb) => listeners.set(name, cb),
      removeEventListener: (name) => listeners.delete(name),
    },
  });
  const input = new exports.InputManager();
  return { input, navigator, document, listeners, ...hidExports,
    advanceTime: (ms) => { now += ms; },
    send: (name, event = {}) => listeners.get(name)?.(event),
    connect: (pad) => { navigator.getGamepads = () => pad ? [null, pad] : []; },
  };
}

function gamepad(mapping = 'standard', id = 'Xbox Controller') {
  return { index: 1, id, mapping, connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
}

function press(pad, index, value = 1) {
  pad.buttons[index] = { value, pressed: value > 0.5 };
}

test('standard pad provides progressive steering and independent analog triggers', () => {
  const f = fixture();
  const pad = gamepad();
  f.connect(pad);
  pad.axes[0] = 0.575;
  press(pad, 7, 0.7);
  press(pad, 6, 0.3);
  f.input.update();
  assert.ok(Math.abs(f.input.steerAxis - 0.5) < 1e-10);
  assert.equal(f.input.throttle, 0.7);
  assert.equal(f.input.brake, 0.3);
  pad.axes[0] = -1;
  f.input.update();
  assert.equal(f.input.steerAxis, -1);
  pad.axes[0] = 0.1;
  f.input.update();
  assert.equal(f.input.steerAxis, 0);
});

test('raw PowerA profile routes triggers, lower face button and action buttons', () => {
  const f = fixture();
  const pad = gamepad('', 'NSW Wired controller (Vendor: 20d6 Product: a713)');
  const events = [];
  for (const name of ['reset', 'cycleCamera', 'pause']) f.input.on(name, () => events.push(name));
  f.connect(pad);
  f.input.update();
  for (const index of [7, 6, 1, 0, 2, 9]) press(pad, index);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  assert.equal(f.input.brake, 1);
  assert.equal(f.input.handbrake, true);
  assert.deepEqual(events, ['pause', 'reset', 'cycleCamera']);
  f.input.update();
  assert.equal(events.length, 3, 'Held buttons must not repeat actions');
  press(pad, 0, 0);
  f.input.update();
  press(pad, 0);
  f.input.update();
  assert.equal(events.at(-1), 'reset');
  assert.equal(events.length, 4);
  press(pad, 0, 0);
  press(pad, 2, 0);
  f.input.update();
  events.length = 0;
  press(pad, 2); // A (Switch), à droite : caméra uniquement.
  f.input.update();
  assert.deepEqual(events, ['cycleCamera']);
  press(pad, 0); // Y (Switch), à gauche : respawn uniquement.
  f.input.update();
  assert.deepEqual(events, ['cycleCamera', 'reset']);
});

test('browser standard mapping takes precedence over PowerA raw mapping', () => {
  const f = fixture();
  const pad = gamepad('standard', 'NSW Wired controller 20d6:a713');
  let resets = 0;
  let cameras = 0;
  f.input.on('reset', () => resets++);
  f.input.on('cycleCamera', () => cameras++);
  f.connect(pad);
  f.input.update();
  press(pad, 0);
  f.input.update();
  assert.equal(f.input.handbrake, true);
  press(pad, 1);
  f.input.update();
  assert.equal(cameras, 1);
  assert.equal(resets, 0);
  press(pad, 2);
  f.input.update();
  assert.equal(resets, 1);
  assert.equal(cameras, 1);
});

test('pause can resume disabled input and held actions do not leak across menus', () => {
  const f = fixture();
  const pad = gamepad();
  let enabled = true;
  let resets = 0;
  f.input.on('pause', () => f.input.setEnabled(enabled = !enabled));
  f.input.on('reset', () => resets++);
  f.connect(pad);
  f.input.update();
  press(pad, 9);
  press(pad, 7);
  f.input.update();
  assert.equal(enabled, false);
  assert.equal(f.input.throttle, 0);
  press(pad, 1);
  press(pad, 9, 0);
  f.input.update();
  press(pad, 9);
  f.input.update();
  assert.equal(enabled, true);
  assert.equal(f.input.throttle, 1);
  assert.equal(resets, 0);
});

test('disconnect and blur immediately clear driving, focus does not trigger held actions', () => {
  const f = fixture();
  const pad = gamepad();
  let resets = 0;
  f.input.on('reset', () => resets++);
  press(pad, 7);
  pad.axes[0] = 1;
  f.connect(pad);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  f.send('blur');
  assert.equal(f.input.throttle, 0);
  f.input.update();
  assert.equal(f.input.steerAxis, 0);
  press(pad, 1);
  f.send('focus');
  f.input.update();
  assert.equal(resets, 0);
  f.connect(null);
  f.input.update();
  assert.equal(f.input.throttle, 0);
  assert.equal(f.input.steerAxis, 0);
});

test('keyboard remains available without API, with denied API or unknown raw pads', () => {
  const f = fixture();
  f.send('keydown', { code: 'ArrowUp' });
  f.send('keydown', { code: 'ArrowLeft' });
  f.navigator.getGamepads = undefined;
  f.input.update();
  assert.equal(f.input.throttle, 1);
  assert.equal(f.input.steerAxis, -1);
  f.navigator.getGamepads = () => { throw new Error('SecurityError'); };
  f.input.update();
  assert.equal(f.input.throttle, 1);
  const pad = gamepad('', 'Unknown flight stick');
  press(pad, 6);
  f.connect(pad);
  f.input.update();
  assert.equal(f.input.brake, 0);
  f.send('keyup', { code: 'ArrowUp' });
  assert.equal(f.input.throttle, 0);
  f.input.dispose();
  assert.equal(f.listeners.size, 0);
});

test('hidden pages ignore gamepads and connecting with held action buttons is harmless', () => {
  const f = fixture();
  const pad = gamepad();
  let pauses = 0;
  f.input.on('pause', () => pauses++);
  press(pad, 9);
  press(pad, 7);
  f.connect(pad);
  f.input.update();
  assert.equal(pauses, 0);
  f.document.hidden = true;
  f.input.update();
  assert.equal(f.input.throttle, 0);
  f.document.hidden = false;
  f.input.update();
  assert.equal(pauses, 0);
});

function usbFixture({ denied = false } = {}) {
  const device = Object.assign(new EventTarget(), {
    vendorId: 0x20d6, productId: 0xa713, opened: false,
    async open() { this.opened = true; },
    async close() { this.opened = false; },
  });
  const hid = Object.assign(new EventTarget(), {
    async getDevices() { return []; },
    async requestDevice(options) {
      assert.equal(options.filters[0].vendorId, 0x20d6);
      assert.equal(options.filters[0].productId, 0xa713);
      if (denied) throw new Error('Access denied');
      return [device];
    },
  });
  const f = fixture(hid);
  return { ...f, device, hid,
    report(bits = 0, x = 128) {
      const bytes = Uint8Array.of(bits & 255, bits >> 8, 8, x, 128, 128, 128, 0);
      device.dispatchEvent(Object.assign(new Event('inputreport'), { data: new DataView(bytes.buffer), reportId: 0 }));
    },
  };
}

test('USB reports drive the car when Chrome exposes no Gamepad at all', async () => {
  const f = usbFixture();
  await f.input.connectGamepad();
  assert.equal(f.device.opened, true);
  assert.match(f.input.gamepadStatus, /Connexion USB ouverte/);
  f.report();
  f.input.update();
  let resets = 0;
  f.input.on('reset', () => resets++);
  f.report((1 << 7) | (1 << 6) | (1 << 1) | (1 << 0), 255);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  assert.equal(f.input.brake, 1);
  assert.equal(f.input.steerAxis, 1);
  assert.equal(f.input.handbrake, true);
  assert.equal(resets, 1);
  assert.match(f.input.gamepadStatus, /Manette PowerA connectée/);
  f.input.update();
  assert.equal(resets, 1);
  f.report();
  f.input.update();
  assert.equal(f.input.throttle, 0);
  assert.equal(f.input.brake, 0);
  assert.equal(f.input.steerAxis, 0);
  assert.equal(f.input.handbrake, false);
  f.input.dispose();
});

test('USB input survives denied Gamepad API and clears on unplugging or losing focus', async () => {
  const f = usbFixture();
  f.navigator.getGamepads = () => { throw new Error('SecurityError'); };
  await f.input.connectGamepad();
  f.report(1 << 7, 0);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  assert.equal(f.input.steerAxis, -1);
  f.send('blur');
  f.input.update();
  assert.equal(f.input.throttle, 0);
  f.send('focus');
  f.hid.dispatchEvent(Object.assign(new Event('disconnect'), { device: f.device }));
  f.input.update();
  assert.equal(f.input.throttle, 0);
  assert.equal(f.input.steerAxis, 0);
  assert.match(f.input.gamepadStatus, /débranchée/);
  f.report(1 << 7);
  f.input.update();
  assert.equal(f.input.throttle, 0, 'Unplugged reports no longer have a listener');
  f.input.dispose();
});

test('USB decoder ignores truncated reports and uses DataView offsets correctly', () => {
  const { decodePowerAReport } = fixture();
  assert.equal(decodePowerAReport(new DataView(new ArrayBuffer(2)), 0), null);
  assert.equal(decodePowerAReport(new DataView(new ArrayBuffer(8)), 1), null);
  const bytes = Uint8Array.of(99, 99, 0x80, 0x02, 8, 128, 128, 128, 128, 0);
  const snapshot = decodePowerAReport(new DataView(bytes.buffer, 2), 0);
  assert.equal(snapshot.buttons[7].pressed, true);
  assert.equal(snapshot.buttons[9].pressed, true);
  assert.equal(snapshot.axes[0], 0);
});

test('USB permission failure is visible and does not prevent keyboard input', async () => {
  const f = usbFixture({ denied: true });
  await f.input.connectGamepad();
  assert.match(f.input.gamepadStatus, /Connexion impossible/);
  f.send('keydown', { code: 'ArrowUp' });
  f.input.update();
  assert.equal(f.input.throttle, 1);
  f.input.dispose();
});

test('USB reconnects a previously authorized device without requesting permission again', async () => {
  const f = usbFixture();
  f.input.dispose();
  f.hid.getDevices = async () => [f.device];
  f.hid.requestDevice = async () => { throw new Error('Unexpected permission dialog'); };
  const restored = new f.PowerAGamepad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.device.opened, true);
  f.report(1 << 7);
  assert.equal(restored.snapshot.buttons[7].pressed, true);
  restored.dispose();
});

test('opening USB without receiving reports is not reported as working controls', async () => {
  const f = usbFixture();
  await f.input.connectGamepad();
  f.advanceTime(3001);
  assert.match(f.input.gamepadStatus, /aucune donnée reçue/);
  f.report();
  assert.match(f.input.gamepadStatus, /Manette PowerA connectée/);
  f.input.dispose();
});

test('connect really closes and reopens a silent USB connection', async () => {
  const f = usbFixture();
  let opens = 0;
  let closes = 0;
  f.device.open = async () => { opens++; f.device.opened = true; };
  f.device.close = async () => { closes++; f.device.opened = false; };
  await f.input.connectGamepad();
  f.advanceTime(5000);
  await f.input.connectGamepad();
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  assert.match(f.input.gamepadStatus, /En attente/);
  f.report(1 << 7);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  f.input.dispose();
});

test('unrecognized reports show their format and clear previous controls', async () => {
  const f = usbFixture();
  await f.input.connectGamepad();
  f.report(1 << 7);
  f.input.update();
  assert.equal(f.input.throttle, 1);
  f.device.dispatchEvent(Object.assign(new Event('inputreport'), {
    data: new DataView(new ArrayBuffer(3)), reportId: 7,
  }));
  f.input.update();
  assert.equal(f.input.throttle, 0);
  assert.match(f.input.gamepadStatus, /rapport 7, 3 octets/);
  f.advanceTime(5000);
  assert.doesNotMatch(f.input.gamepadStatus, /aucune donnée/);
  f.input.dispose();
});
