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

// The order ZIG SIM packs quaternion components into its OSC args. Internally we
// always work in (w, x, y, z); this only describes what arrives on the wire.
//
// TROUBLESHOOTING: if the pointer moves on the wrong axis, moves diagonally when
// you rotate along one axis, or barely responds at all, flip this to "xyzw".
// That is the single most likely cause, and it is a one-word change.
const QUATERNION_ORDER = "wxyz"; // "wxyz" | "xyzw"

// --- State ------------------------------------------------------------------

let socket = null; // current WebSocket instance
let connected = false; // true while the socket is open
let reconnectTimer = null; // pending reconnect, so we never stack retries

// Latest args keyed by OSC address, e.g. { "/ZIGSIM/abc/accel": [0.1, -0.9, 0.2] }.
const latest = {};

// The orientation the pointer treats as "screen centre", captured by
// setReference(). Null until the first quaternion arrives.
let referenceQuat = null;

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

// The current orientation as a normalised (w, x, y, z), or null if no quaternion
// has arrived yet or the one we have is degenerate.
function readQuaternion() {
  const args = argsFor("quaternion");
  if (args === null) return null;

  // Unpack according to what the phone actually sends, into our (w,x,y,z) order.
  const q =
    QUATERNION_ORDER === "xyzw"
      ? [num(args, 3), num(args, 0), num(args, 1), num(args, 2)]
      : [num(args, 0), num(args, 1), num(args, 2), num(args, 3)];

  // Normalise: a drifting magnitude would otherwise scale the extracted angles.
  const mag = Math.hypot(q[0], q[1], q[2], q[3]);
  if (mag < 1e-6) return null; // all-zeros or garbage — not a rotation
  return [q[0] / mag, q[1] / mag, q[2] / mag, q[3] / mag];
}

// A snapshot of the phone's current motion. Safe to call every frame; always
// returns a fully-formed object, zero-filled for streams not yet received.
function getSensorState() {
  const gyroArgs = argsFor("gyro");
  const accelArgs = argsFor("accel");

  const gyro = { x: num(gyroArgs, 0), y: num(gyroArgs, 1), z: num(gyroArgs, 2) };
  const accel = { x: num(accelArgs, 0), y: num(accelArgs, 1), z: num(accelArgs, 2) };

  // Identity rotation, not all-zeros — a zero quaternion isn't a valid rotation
  // and would blow up any math done with it downstream.
  const quaternion = readQuaternion() || [1, 0, 0, 0];

  // Gyro is a speed signal only — nothing integrates it into an angle.
  const gyroMag = Math.sqrt(gyro.x * gyro.x + gyro.y * gyro.y + gyro.z * gyro.z);

  return { quaternion, gyro, accel, gyroMag, connected };
}

// --- Pointer ----------------------------------------------------------------
//
// Orientation is absolute, so "where is the phone aiming" is answered by
// comparing the current orientation against a remembered one — no accumulation,
// nothing to drift. Recentering is just replacing that remembered orientation.

// Remember the current orientation as screen centre. Returns false (and changes
// nothing) if no usable quaternion has arrived yet.
function setReference() {
  const q = readQuaternion();
  if (q === null) return false;
  referenceQuat = q;
  return true;
}

// Where the phone is aiming, relative to the reference orientation.
// Returns { yaw, pitch, valid } with angles in radians.
function getPointer() {
  const q = readQuaternion();
  if (q === null) return { yaw: 0, pitch: 0, valid: false };

  // First usable reading defines centre, so the pointer works before anyone
  // thinks to press C.
  if (referenceQuat === null) referenceQuat = q;

  // Rotation *from* the reference *to* now. For a unit quaternion the inverse
  // is just the conjugate.
  const qr = quatMultiply(quatConjugate(referenceQuat), q);
  return { ...eulerFrom(qr), valid: true };
}

// --- Quaternion maths -------------------------------------------------------

function quatConjugate(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

function quatMultiply(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

// All three Tait-Bryan angles of a relative rotation, in radians. Which of these
// corresponds to "left/right" versus "up/down" on screen depends on how the phone
// is held, so all three are returned and the caller picks — see POINTER_AXIS_X
// and POINTER_AXIS_Y in saber.js.
function eulerFrom(q) {
  const [w, x, y, z] = q;

  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));

  // Clamped because rounding can push this a hair outside asin's domain, which
  // would return NaN and freeze the cursor permanently.
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const pitch = Math.asin(sinPitch);

  return { yaw, pitch, roll };
}

// --- One Euro filter --------------------------------------------------------
//
// Low-pass filter with a cutoff that rises with speed: heavy smoothing when the
// signal is nearly still (kills jitter), light smoothing when it's moving fast
// (kills lag). A fixed lerp can only trade one for the other.
//
// Reference: Casiez, Roussel & Vogel, "1€ Filter" (CHI 2012).

class OneEuroFilter {
  constructor(minCutoff, beta, derivativeCutoff = 1.0) {
    this.minCutoff = minCutoff; // smoothing floor — lower = steadier at rest
    this.beta = beta; // speed response — higher = less lag when moving
    this.derivativeCutoff = derivativeCutoff;

    this.lastValue = null;
    this.lastFiltered = null;
    this.lastDerivative = 0;
    this.lastTime = null;
  }

  // Exponential smoothing factor for a given cutoff frequency and timestep.
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, timestampMs) {
    if (this.lastFiltered === null) {
      this.lastValue = value;
      this.lastFiltered = value;
      this.lastTime = timestampMs;
      return value;
    }

    // Guard against a zero or negative dt, which would divide by zero. Falls
    // back to one frame at 60fps.
    let dt = (timestampMs - this.lastTime) / 1000;
    if (!(dt > 0)) dt = 1 / 60;

    // Smooth the rate of change, then let it raise the cutoff.
    const derivative = (value - this.lastFiltered) / dt;
    const aD = OneEuroFilter.alpha(this.derivativeCutoff, dt);
    this.lastDerivative = aD * derivative + (1 - aD) * this.lastDerivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.lastDerivative);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.lastFiltered = a * value + (1 - a) * this.lastFiltered;

    this.lastValue = value;
    this.lastTime = timestampMs;
    return this.lastFiltered;
  }

  setMinCutoff(minCutoff) {
    this.minCutoff = minCutoff;
  }
}

// Debugging aid: every address seen so far, and which one each sensor bound to.
// Also the starting point for Phase 2's per-device routing.
function getSensorAddresses() {
  return { seen: Object.keys(latest).sort(), bound: { ...sensorAddress } };
}

// Connect as soon as the script loads — the game can start drawing before any
// data arrives, and getSensorState() will report zeros until it does.
connect();
