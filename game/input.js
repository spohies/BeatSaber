// input.js
//
// Live connection to the sensor bridge, exposed as a clean motion snapshot.
//
//   phone (ZIG SIM)  --OSC/UDP-->  bridge  --WebSocket/JSON-->  this module
//
// The bridge forwards each OSC message as { address, args }. Addresses look like
// "/ZIGSIM/<device-id>/gyro" — the sensor name is in there, but so is a per-device
// id we don't control, so we match sensors by keyword rather than exact address.
//
// Plain JavaScript on purpose: no p5, no DOM. The game reads one function,
// getSensorState(), once per frame.

// --- Configuration ----------------------------------------------------------

const WS_URL = "ws://localhost:8081";
const RECONNECT_DELAY_MS = 1000;

// Which substring identifies each sensor stream inside an OSC address.
// Matched case-insensitively, so "/ZIGSIM/abc/gyro" and "/zigsim/abc/Gyro" both work.
// These are substrings, so "accel" also catches "acceleration"/"userAccel".
const SENSOR_KEYWORDS = {
  gyro: "gyro",
  accel: "accel",
  quaternion: "quaternion",
};

// --- State ------------------------------------------------------------------

let socket = null; // current WebSocket instance
let connected = false; // true while the socket is open
let reconnectTimer = null; // pending reconnect, so we never stack retries

// Latest args keyed by OSC address, e.g. { "/ZIGSIM/abc/accel": [0.1, -0.9, 0.2] }.
const latest = {};

// Once we've seen an address matching a sensor keyword we remember it, so we
// aren't re-scanning every address on every read. Phase 1 is one phone, so the
// first matching address per sensor wins; Phase 2 will key these by device id.
const sensorAddress = {
  gyro: null,
  accel: null,
  quaternion: null,
};

// --- Connection -------------------------------------------------------------

// Open (or re-open) the WebSocket and wire up its handlers.
function connect() {
  reconnectTimer = null;
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected = true;
    console.log("[input] connected to " + WS_URL);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (!data || typeof data.address !== "string") return;

      latest[data.address] = data.args;
      claimAddress(data.address);
    } catch (err) {
      console.error("[input] bad message:", err);
    }
  };

  socket.onclose = () => {
    connected = false;
    scheduleReconnect();
  };

  socket.onerror = () => {
    // An error is normally followed by onclose, which handles the retry. Close
    // here anyway in case the socket is left half-open and never fires onclose.
    if (socket) socket.close();
  };
}

// Retry after a short delay, unless a retry is already pending.
function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  console.log(`[input] disconnected — retrying in ${RECONNECT_DELAY_MS}ms`);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

// If this address identifies a sensor we haven't bound yet, bind it.
function claimAddress(address) {
  const lower = address.toLowerCase();
  for (const sensor of Object.keys(SENSOR_KEYWORDS)) {
    if (sensorAddress[sensor] === null && lower.includes(SENSOR_KEYWORDS[sensor])) {
      sensorAddress[sensor] = address;
      console.log(`[input] ${sensor} <- ${address}`);
    }
  }
}

// --- Reading ----------------------------------------------------------------

// The most recent args for a sensor, or null if that stream hasn't arrived yet.
function argsFor(sensor) {
  const address = sensorAddress[sensor];
  if (address === null) return null;
  const args = latest[address];
  return Array.isArray(args) ? args : null;
}

// Read one number out of an args array, falling back to 0 for missing values or
// anything non-finite (a NaN reaching the game loop poisons every later frame).
function num(args, index) {
  if (args === null) return 0;
  const value = args[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// A snapshot of the phone's current motion. Safe to call every frame; always
// returns a fully-formed object, zero-filled for streams not yet received.
function getSensorState() {
  const gyroArgs = argsFor("gyro");
  const accelArgs = argsFor("accel");
  const quatArgs = argsFor("quaternion");

  const gyro = { x: num(gyroArgs, 0), y: num(gyroArgs, 1), z: num(gyroArgs, 2) };
  const accel = { x: num(accelArgs, 0), y: num(accelArgs, 1), z: num(accelArgs, 2) };

  // Identity rotation, not all-zeros — a zero quaternion isn't a valid rotation
  // and would blow up any math we do with it in Phase 2.
  const quaternion =
    quatArgs === null
      ? [1, 0, 0, 0]
      : [num(quatArgs, 0), num(quatArgs, 1), num(quatArgs, 2), num(quatArgs, 3)];

  const gyroMag = Math.sqrt(gyro.x * gyro.x + gyro.y * gyro.y + gyro.z * gyro.z);

  return { quaternion, gyro, accel, gyroMag, connected };
}

// Debugging aid: every address seen so far, and which one each sensor bound to.
// Also the starting point for Phase 2's per-device routing.
function getSensorAddresses() {
  return { seen: Object.keys(latest).sort(), bound: { ...sensorAddress } };
}

// Connect as soon as the script loads — the game can start drawing before any
// data arrives, and getSensorState() will report zeros until it does.
connect();
