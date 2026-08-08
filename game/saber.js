// saber.js
//
// The player's saber — a Wii-style pointer driven by where the phone is aiming,
// rendered as a glowing 3D blade in WEBGL.
//
// Orientation comes from the quaternion, which is absolute: the phone's rotation
// is measured against a reference orientation captured at recenter time, so the
// cursor cannot drift or wind up. Nothing here integrates angular velocity.
//
// COORDINATES: the saber aims at a point on the "hit plane", the z = 0 plane
// where blocks get sliced. Under p5's default WEBGL camera, 1 world unit on
// that plane = 1 screen pixel, so this class does all its aiming math in plain
// screen pixels (this.x / this.y, origin top-left, like 2D mode) and converts
// to world coordinates (origin at screen centre) only at the end:
//
//   tipX = x - width/2,  tipY = y - height/2,  tipZ = 0
//
// That keeps cursorSpeed in px/frame, so slice thresholds tuned in 2D carry
// straight over.
//
// Requires input.js to be loaded first, for getPointer(), setReference(),
// getSensorState() and OneEuroFilter.

// --- Aim mapping ------------------------------------------------------------

// input.js already resolves the grip: getPointer() returns +yaw = aiming right,
// +pitch = aiming up, regardless of how the phone is held. So the only mapping
// left here is sign flips if a particular player prefers inverted aim.
const POINTER_INVERT_X = false;
const POINTER_INVERT_Y = false;

// --- Sensitivity ------------------------------------------------------------

// Total rotation, in degrees, that spans the full width/height of the screen.
// 90 means edge to edge is a 90° sweep — so ±45° from centre. Larger = calmer
// and more physical movement; smaller = twitchier. Tunable live with [ and ].
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
// a phone lying still produces a perfectly stationary saber.
const POINTER_DEADZONE_DEG = 0.2;

// --- 3D geometry ------------------------------------------------------------

// Where the saber is "held": just right of and below screen centre, close to
// the camera (default camera sits around z ≈ 0.87 × height, i.e. ~700-900).
// The blade points from here through the aim point on the hit plane, which is
// what makes the whole scene read as first-person.
const SABER_BASE = { x: 190, y: 340, z: 560 };
const SABER_PLANE_Z = 0; // must match HIT_PLANE_Z in sketch.js

const SABER_HANDLE_LENGTH = 90; // dark grip section, world units from the base
const SABER_BLADE_OVERSHOOT = 140; // blade extends this far past the aim point

const BLADE_CORE_RADIUS = 4.5; // white-hot centre
const BLADE_GLOW_RADIUS = 13; // translucent halo around the core

// Trail length in frames. Long enough that a flick reads as a slash, short
// enough that it doesn't smear while aiming.
const SABER_TRAIL_LENGTH = 14;

const RECENTER_FLASH_MS = 600;

// --- Saber ------------------------------------------------------------------

class Saber {
  constructor(x, y) {
    this.x = x; // aim point in screen pixels (top-left origin)
    this.y = y;
    this.prevX = x; // position last frame, for velocity
    this.prevY = y;

    // Aim point in world coordinates on the hit plane (centre origin). These
    // are what sketch.js tests blocks against.
    this.tipX = 0;
    this.tipY = 0;
    this.prevTipX = 0;
    this.prevTipY = 0;

    this.cursorSpeed = 0; // px/frame the aim point is travelling
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

    this.trail = []; // recent tip positions in world coords
    this.recenteredAt = -Infinity;
  }

  update() {
    this.gyroMag = getSensorState().gyroMag;

    const aim = getPointer();
    this.valid = aim.valid;

    if (aim.valid) {
      const now = millis();

      // Smooth while the signal is still an angle — filtering in pixels would
      // fight the clamp at the screen edges.
      const rawX = this.filterX.filter(aim.yaw, now);
      const rawY = this.filterY.filter(aim.pitch, now);

      const angleX = this.applyDeadzone(rawX, "heldAngleX");
      const angleY = this.applyDeadzone(rawY, "heldAngleY");

      // DEGREES_PER_SCREEN is the *total* sweep, so half of it reaches an edge.
      const halfRangeX = radians(this.degreesPerScreenX / 2);
      const halfRangeY = radians(this.degreesPerScreenY / 2);

      const nx = (POINTER_INVERT_X ? -angleX : angleX) / halfRangeX;
      // +pitch = aiming up, but screen y grows downward, hence the minus.
      const ny = (POINTER_INVERT_Y ? angleY : -angleY) / halfRangeY;

      // Clamp to the canvas so the aim point can't be lost off-screen — with a
      // relative reference it would otherwise be hard to find again.
      this.x = constrain(width / 2 + nx * (width / 2), 0, width);
      this.y = constrain(height / 2 + ny * (height / 2), 0, height);
    }

    this.cursorSpeed = dist(this.x, this.y, this.prevX, this.prevY);

    // Screen px -> world units on the z = 0 hit plane (1:1 under the default
    // camera; WEBGL's origin is the screen centre).
    this.prevTipX = this.prevX - width / 2;
    this.prevTipY = this.prevY - height / 2;
    this.tipX = this.x - width / 2;
    this.tipY = this.y - height / 2;

    this.trail.push({ x: this.tipX, y: this.tipY });
    if (this.trail.length > SABER_TRAIL_LENGTH) this.trail.shift();

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

  // --- Drawing (WEBGL) -------------------------------------------------------

  draw() {
    // Dimmed until real orientation data flows, so a dead sensor is obvious
    // rather than looking like a saber stuck at centre.
    const vis = this.valid ? 1 : 0.35;

    this.drawTrail(vis);

    const base = [SABER_BASE.x, SABER_BASE.y, SABER_BASE.z];
    const aim = [this.tipX, this.tipY, SABER_PLANE_Z];

    // Unit vector from the hand toward the aim point — the blade's direction.
    let dx = aim[0] - base[0];
    let dy = aim[1] - base[1];
    let dz = aim[2] - base[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;

    const handleEnd = [
      base[0] + dx * SABER_HANDLE_LENGTH,
      base[1] + dy * SABER_HANDLE_LENGTH,
      base[2] + dz * SABER_HANDLE_LENGTH,
    ];
    const bladeEnd = [
      aim[0] + dx * SABER_BLADE_OVERSHOOT,
      aim[1] + dy * SABER_BLADE_OVERSHOOT,
      aim[2] + dz * SABER_BLADE_OVERSHOOT,
    ];

    noStroke();

    // Handle: dark, matte, barely emissive so it never disappears into the bg.
    emissiveMaterial(38, 40, 52);
    this.beam(base, handleEnd, 10);

    // Glow first (bigger, translucent), then the white-hot core on top.
    // emissiveMaterial ignores scene lights — that IS the neon look.
    emissiveMaterial(120, 220, 255, 80 * vis);
    this.beam(handleEnd, bladeEnd, BLADE_GLOW_RADIUS);

    emissiveMaterial(255, 255, 255, 235 * vis);
    this.beam(handleEnd, bladeEnd, BLADE_CORE_RADIUS);

    // Reticle at the aim point on the hit plane — this is "the cursor".
    push();
    translate(aim[0], aim[1], aim[2]);
    emissiveMaterial(120, 220, 255, 90 * vis);
    sphere(14, 12, 8);
    emissiveMaterial(255, 255, 255, 255 * vis);
    sphere(6, 10, 6);
    pop();
  }

  // Draw a cylinder spanning two points in 3D.
  //
  // p5's cylinder() is built along the local Y axis, centred at the origin, so
  // drawing between arbitrary points a and b takes three steps:
  //   1. translate to the segment's midpoint,
  //   2. rotate the local Y axis onto the segment direction d — the rotation
  //      axis is  yhat × d = (d.z, 0, -d.x)  and the angle is  acos(yhat · d)
  //      = acos(d.y),
  //   3. draw a cylinder whose height is the segment length.
  beam(a, b, radius) {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;

    push();
    translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);

    const angle = Math.acos(constrain(dy, -1, 1));
    const axisX = dz;
    const axisZ = -dx;
    if (Math.hypot(axisX, axisZ) > 1e-6) {
      rotate(angle, [axisX, 0, axisZ]);
    } else if (dy < 0) {
      // d is anti-parallel to Y: cross product vanishes; any perpendicular
      // axis works for the 180° flip.
      rotate(PI, [1, 0, 0]);
    }

    cylinder(radius, len, 12, 1);
    pop();
  }

  // The trail lives on the hit plane and is what makes a fast flick read as a
  // slash rather than a teleport.
  drawTrail(vis) {
    for (let i = 1; i < this.trail.length; i++) {
      const fade = (i / this.trail.length) * vis;
      stroke(120, 220, 255, 200 * fade * fade);
      strokeWeight(10 * fade);
      // z = 2: a hair in front of the hit plane so it never z-fights the frame.
      line(this.trail[i - 1].x, this.trail[i - 1].y, 2, this.trail[i].x, this.trail[i].y, 2);
    }
    noStroke();
  }
}
