// saber.js
//
// One on-screen saber, driven by the phone's motion.
//
// The phone reports orientation and motion but never position, so the saber is
// anchored at a fixed pivot and only its *angle* is under player control. Tilt
// comes from the accelerometer (which senses gravity, an absolute reference, so
// it never drifts) rather than from integrating the gyro (which always does).
//
// Requires input.js to be loaded first, for getSensorState().

// --- Tuning -----------------------------------------------------------------

// How quickly the blade chases the phone's tilt. 0 = frozen, 1 = no smoothing
// (jittery — the raw accelerometer is noisy).
const SABER_SMOOTHING = 0.25;

// During a swing the accelerometer mostly reads the swing's own acceleration
// rather than gravity, so the derived tilt briefly goes wild — exactly when the
// blade is most visible. Above this gyro magnitude we stop trusting it as much
// and let the blade coast, which reads as a clean arc instead of a flail.
const SABER_TRUST_GYRO = 2.0;
const SABER_SMOOTHING_WHILE_SWINGING = 0.06;

// Blade geometry, in pixels.
const SABER_CORE_WEIGHT = 6;
const SABER_GLOW_LAYERS = 4;

// --- Tilt mapping -----------------------------------------------------------

// Turn the gravity vector into an on-screen angle, where 0 = blade straight up
// and positive = tilted clockwise (to the right).
//
// TROUBLESHOOTING: this is the one function to edit if the saber tilts the wrong
// way or around the wrong axis — it depends entirely on how you hold the phone.
// Swap which axes are read, or negate one, until an upright phone gives an
// upright saber and tilting right tilts the blade right.
function tiltAngleFromAccel(accel) {
  return Math.atan2(accel.x, -accel.y);
}

// --- Saber ------------------------------------------------------------------

class Saber {
  // pivot (x, y) sits near the bottom of the screen; length is the blade length.
  constructor(x, y, length) {
    this.x = x;
    this.y = y;
    this.length = length;

    this.angle = 0; // current on-screen angle, radians, 0 = up
    this.gyroMag = 0; // rotation speed this frame
    this.swingDir = 0; // -1, 0, or +1 — rough direction of the current swing

    // Blade tip, recomputed each update(). Handy for hit effects and Phase 2.
    this.tipX = x;
    this.tipY = y - length;
  }

  update() {
    const state = getSensorState();
    this.gyroMag = state.gyroMag;

    // Chase the phone's tilt, easing off while swinging (see SABER_TRUST_GYRO).
    const target = tiltAngleFromAccel(state.accel);
    const smoothing =
      this.gyroMag > SABER_TRUST_GYRO
        ? SABER_SMOOTHING_WHILE_SWINGING
        : SABER_SMOOTHING;
    this.angle += shortestAngleTo(this.angle, target) * smoothing;

    // Direction of the dominant gyro axis. Only updated while actually moving,
    // so it holds the last real swing's direction instead of chasing noise.
    if (this.gyroMag > SABER_TRUST_GYRO) {
      this.swingDir = Math.sign(dominantAxis(state.gyro));
    }

    // Screen y grows downward, so "up" from the pivot is -cos.
    this.tipX = this.x + Math.sin(this.angle) * this.length;
    this.tipY = this.y - Math.cos(this.angle) * this.length;
  }

  isSwinging(threshold) {
    return this.gyroMag > threshold;
  }

  draw() {
    const swinging = this.isSwinging(SABER_TRUST_GYRO);

    push();
    // Glow: a few translucent strokes, widest and faintest first. Brighter and
    // wider while swinging, which is the whole visual cue that a swing landed.
    const glowScale = swinging ? 1.6 : 1.0;
    for (let i = SABER_GLOW_LAYERS; i > 0; i--) {
      const spread = i * 4 * glowScale;
      stroke(120, 220, 255, 22 * glowScale);
      strokeWeight(SABER_CORE_WEIGHT + spread);
      line(this.x, this.y, this.tipX, this.tipY);
    }

    // Bright core.
    stroke(235, 250, 255);
    strokeWeight(SABER_CORE_WEIGHT);
    line(this.x, this.y, this.tipX, this.tipY);

    // Hilt, so the pivot reads as a held object rather than a floating line.
    stroke(90, 100, 115);
    strokeWeight(SABER_CORE_WEIGHT + 6);
    line(this.x, this.y, this.x - Math.sin(this.angle) * 22, this.y + Math.cos(this.angle) * 22);
    pop();
  }
}

// --- Helpers ----------------------------------------------------------------

// Signed distance from angle a to angle b, wrapped into [-PI, PI]. Without this,
// easing across the ±PI seam sends the blade the long way round.
function shortestAngleTo(a, b) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// The gyro component with the largest magnitude, sign intact.
function dominantAxis(gyro) {
  let largest = gyro.x;
  if (Math.abs(gyro.y) > Math.abs(largest)) largest = gyro.y;
  if (Math.abs(gyro.z) > Math.abs(largest)) largest = gyro.z;
  return largest;
}
