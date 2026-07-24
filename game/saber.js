// saber.js
//
// The player's on-screen cursor — a Wii-style pointer driven by where the phone
// is aiming.
//
// Orientation comes from the quaternion, which is absolute: the phone's rotation
// is measured against a reference orientation captured at recenter time, so the
// cursor cannot drift or wind up. Nothing here integrates angular velocity.
//
// Requires input.js to be loaded first, for getPointer(), setReference(),
// getSensorState() and OneEuroFilter.

// --- Axis mapping -----------------------------------------------------------

// Which rotation axis drives which screen axis. Each is "yaw", "pitch", or
// "roll" — the three Tait-Bryan angles of the phone's rotation away from its
// reference orientation.
//
// TROUBLESHOOTING, in this order:
//   Cursor moves vertically when you pan the phone sideways?  swap these two.
//   Cursor moves the right way but backwards?                 flip the INVERT below.
// The correct combination depends entirely on how you hold the phone, so expect
// to try a couple.
const POINTER_AXIS_X = "pitch";
const POINTER_AXIS_Y = "yaw";

const POINTER_INVERT_X = false;
const POINTER_INVERT_Y = false;

// --- Sensitivity ------------------------------------------------------------

// Total rotation, in degrees, that spans the full width/height of the screen.
// 90 means edge to edge is a 90° sweep — so ±45° from centre. Larger = calmer
// and more physical movement; smaller = twitchier.
const DEGREES_PER_SCREEN_X = 90;
const DEGREES_PER_SCREEN_Y = 90;

// --- Smoothing --------------------------------------------------------------

// One Euro filter, applied to the rotation angles before they become pixels.
// MIN_CUTOFF sets how steady the cursor is when held still — lower is steadier
// but adds lag. BETA sets how quickly smoothing backs off as you move — raise it
// if fast flicks feel like they drag behind your hand.
const MIN_CUTOFF = 1.0;
const BETA = 0.01;

// Rotation smaller than this is treated as sensor noise and ignored outright, so
// a phone lying still produces a perfectly stationary cursor.
const POINTER_DEADZONE_DEG = 0.2;

// --- Appearance -------------------------------------------------------------

// Trail length in frames. Long enough that a flick reads as a slash, short enough
// that it doesn't smear while aiming.
const POINTER_TRAIL_LENGTH = 12;

const RECENTER_FLASH_MS = 600;

// --- Pointer ----------------------------------------------------------------

class Pointer {
  constructor(x, y) {
    this.x = x; // on-screen position
    this.y = y;
    this.prevX = x; // position last frame, for velocity
    this.prevY = y;

    this.cursorSpeed = 0; // px/frame the cursor is travelling
    this.gyroMag = 0; // phone rotation speed (not used for scoring)
    this.valid = false; // false until a usable quaternion arrives

    // Live-tunable copies of the constants above, so they can be dialled in from
    // the keyboard without editing the file.
    this.degreesPerScreenX = DEGREES_PER_SCREEN_X;
    this.degreesPerScreenY = DEGREES_PER_SCREEN_Y;
    this.minCutoff = MIN_CUTOFF;

    // One filter per screen axis — they see different signals.
    this.filterX = new OneEuroFilter(MIN_CUTOFF, BETA);
    this.filterY = new OneEuroFilter(MIN_CUTOFF, BETA);

    // Last angles that cleared the deadzone, in radians.
    this.heldAngleX = 0;
    this.heldAngleY = 0;

    this.trail = [];
    this.recenteredAt = -Infinity;
  }

  update() {
    this.gyroMag = getSensorState().gyroMag;

    const aim = getPointer();
    this.valid = aim.valid;

    if (aim.valid) {
      const now = millis();

      // Pick the rotation axis feeding each screen axis, then smooth it while
      // it's still an angle — filtering in pixels would fight the clamp at the
      // screen edges.
      const rawX = this.filterX.filter(aim[POINTER_AXIS_X], now);
      const rawY = this.filterY.filter(aim[POINTER_AXIS_Y], now);

      const angleX = this.applyDeadzone(rawX, "heldAngleX");
      const angleY = this.applyDeadzone(rawY, "heldAngleY");

      // DEGREES_PER_SCREEN is the *total* sweep, so half of it reaches an edge.
      const halfRangeX = radians(this.degreesPerScreenX / 2);
      const halfRangeY = radians(this.degreesPerScreenY / 2);

      const nx = (POINTER_INVERT_X ? -angleX : angleX) / halfRangeX;
      const ny = (POINTER_INVERT_Y ? -angleY : angleY) / halfRangeY;

      // Clamp to the canvas so the cursor can't be lost off-screen — with a
      // relative reference it would otherwise be hard to find again.
      this.x = constrain(width / 2 + nx * (width / 2), 0, width);
      this.y = constrain(height / 2 + ny * (height / 2), 0, height);
    }

    this.cursorSpeed = dist(this.x, this.y, this.prevX, this.prevY);

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > POINTER_TRAIL_LENGTH) this.trail.shift();

    this.prevX = this.x;
    this.prevY = this.y;
  }

  // Hold the previous angle until the new one differs by more than the deadzone,
  // so noise below that threshold moves the cursor not at all.
  applyDeadzone(angle, heldField) {
    if (Math.abs(angle - this[heldField]) > radians(POINTER_DEADZONE_DEG)) {
      this[heldField] = angle;
    }
    return this[heldField];
  }

  // Phone rotating fast enough to count as a deliberate swing. Not used for
  // scoring — kept because gyro speed is still a useful signal for Phase 2.
  isSwinging(threshold) {
    return this.gyroMag > threshold;
  }

  // Capture the current orientation as screen centre.
  recenter() {
    if (setReference()) {
      this.recenteredAt = millis();
    }
  }

  // --- Live tuning ----------------------------------------------------------

  // Both axes move together, which keeps the cursor's aspect feeling consistent.
  adjustDegreesPerScreen(delta) {
    this.degreesPerScreenX = constrain(this.degreesPerScreenX + delta, 10, 360);
    this.degreesPerScreenY = constrain(this.degreesPerScreenY + delta, 10, 360);
  }

  adjustMinCutoff(delta) {
    this.minCutoff = constrain(this.minCutoff + delta, 0.1, 20);
    this.filterX.setMinCutoff(this.minCutoff);
    this.filterY.setMinCutoff(this.minCutoff);
  }

  // --- Drawing --------------------------------------------------------------

  draw() {
    this.drawTrail();
    this.drawCrosshair();
    this.drawRecenterFlash();
  }

  // The trail is what makes a fast flick read as a slash rather than a teleport.
  drawTrail() {
    noFill();
    for (let i = 1; i < this.trail.length; i++) {
      const fade = i / this.trail.length;
      stroke(120, 220, 255, 200 * fade * fade);
      strokeWeight(10 * fade);
      line(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i].x, this.trail[i].y);
    }
  }

  drawCrosshair() {
    push();
    translate(this.x, this.y);

    // Dimmed until real orientation data is flowing, so a dead sensor is obvious
    // rather than looking like a cursor stuck at centre.
    const alpha = this.valid ? 255 : 70;
    const arm = 14;

    stroke(235, 250, 255, alpha);
    strokeWeight(2);
    line(-arm, 0, -5, 0);
    line(5, 0, arm, 0);
    line(0, -arm, 0, -5);
    line(0, 5, 0, arm);

    noFill();
    stroke(120, 220, 255, alpha);
    strokeWeight(2);
    circle(0, 0, 26);

    noStroke();
    fill(255, 255, 255, alpha);
    circle(0, 0, 6);
    pop();
  }

  drawRecenterFlash() {
    const since = millis() - this.recenteredAt;
    if (since > RECENTER_FLASH_MS) return;

    const t = since / RECENTER_FLASH_MS;

    // Ring expanding from screen centre — where the cursor has just been sent.
    push();
    noFill();
    stroke(120, 240, 180, 220 * (1 - t));
    strokeWeight(3);
    circle(width / 2, height / 2, 40 + t * 160);

    noStroke();
    fill(120, 240, 180, 255 * (1 - t));
    textSize(18);
    textAlign(CENTER, CENTER);
    text("RECENTERED", width / 2, height / 2 + 60);
    pop();
  }
}
