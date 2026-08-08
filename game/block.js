// block.js
//
// One incoming block — the thing you slice.
//
// A block spawns deep in the scene (large negative z, near the vanishing point)
// in a lane/row cell, flies toward the camera along +z at a fixed speed, and is
// scoreable during the window where it overlaps the hit plane at z = 0. The
// main loop owns that decision; a block only reports where it is.
//
// COORDINATES (p5 WEBGL): origin at screen centre, +x right, +y DOWN,
// +z toward the viewer. So "far away" is negative z and blocks travel +z.
//
// MATERIALS: everything here is emissiveMaterial(), never fill()+lights. p5
// keeps material flags on the renderer until something else overwrites them,
// and plain fill() does NOT clear them — so mixing the two makes lit shapes
// inherit whatever emissive colour was set last, turning blocks into flat
// white boxes. Committing to all-emissive sidesteps that entirely, and neon is
// the look we want anyway. (2D primitives like circle/triangle are the one
// exception: immediate-mode shapes ignore materials and read fill().)
//
// No sensor dependency — this file is pure p5 drawing and arithmetic.

// --- Tuning -----------------------------------------------------------------

const BLOCK_SIZE = 110; // cube edge, world units

// How far (in z units of travel) a freshly spawned block takes to fade in from
// nothing — hides the pop of instantiation at the vanishing point.
const BLOCK_FADE_IN_DISTANCE = 900;

// Blocks that get past you fade out over this stretch rather than flying into
// the camera. Without it they scale up without bound as they approach the eye
// and fill the whole screen a frame before despawning. Keep the end value at
// or below DESPAWN_Z in sketch.js.
const BLOCK_FADE_OUT_START_Z = 40;
const BLOCK_FADE_OUT_END_Z = 200;

// A sliced block bursts outward and vanishes, so a hit reads as destruction
// rather than "the block turned white and kept coming".
const BLOCK_POP_MS = 220;
const BLOCK_POP_SCALE = 0.7; // extra size at the end of the burst

// Cut directions. Only "any" is used in Phase 1; the rest exist so the arrow
// rendering and the beat-map format are already correct when Phase 2 starts
// enforcing that the swing direction matches.
const CUT_DIRECTIONS = {
  any: null, // no required direction — drawn as a dot
  up: -Math.PI / 2,
  down: Math.PI / 2,
  left: Math.PI,
  right: 0,
};

// --- Block ------------------------------------------------------------------

class Block {
  // x, y: the centre of the lane/row cell this block flies down (world units).
  // z: spawn depth (large negative). speed: world units per frame along +z.
  constructor(x, y, z, speed) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.spawnZ = z; // remembered for the fade-in
    this.speed = speed;

    this.size = BLOCK_SIZE;
    this.state = "incoming"; // "incoming" | "hit" | "missed"
    this.cutDirection = "any"; // Phase 2 will vary this per beat-map note
    this.hitAt = 0; // millis() the slice landed, for the burst animation
  }

  update() {
    this.z += this.speed;
  }

  // True while the block overlaps the scoreable window around the hit plane.
  inHitZone(hitZ, tol) {
    return Math.abs(this.z - hitZ) <= tol;
  }

  markHit() {
    this.state = "hit";
    this.hitAt = millis();
  }

  // 0 -> 1 through the burst animation. Always 0 for blocks that weren't hit.
  popProgress() {
    if (this.state !== "hit") return 0;
    return constrain((millis() - this.hitAt) / BLOCK_POP_MS, 0, 1);
  }

  // True once the block has finished bursting, or flown close enough to the
  // camera that keeping it would just be a screen-filling smear.
  isGone(despawnZ) {
    if (this.state === "hit" && this.popProgress() >= 1) return true;
    return this.z > despawnZ;
  }

  // Combined fade-in (leaving the vanishing point), fade-out (passing the
  // camera) and burst fade, as a 0..1 multiplier.
  opacity() {
    const fadeIn = constrain((this.z - this.spawnZ) / BLOCK_FADE_IN_DISTANCE, 0, 1);
    const fadeOut =
      1 -
      constrain(
        (this.z - BLOCK_FADE_OUT_START_Z) / (BLOCK_FADE_OUT_END_Z - BLOCK_FADE_OUT_START_Z),
        0,
        1
      );
    return fadeIn * fadeOut * (1 - this.popProgress());
  }

  draw() {
    const fade = 255 * this.opacity();
    if (fade < 2) return; // fully faded — nothing to draw

    const half = this.size / 2;
    // Named "burst", not "pop": a local called pop would shadow p5's global
    // pop() for the rest of this method and break the push/pop pair below.
    const burst = this.popProgress();

    push();
    translate(this.x, this.y, this.z);
    if (burst > 0) scale(1 + burst * BLOCK_POP_SCALE);

    // Colour carries the state: neutral while live, bright on a successful
    // slice, dim and desaturated once missed. The stroke draws the cube's
    // edges, which is what gives an emissive (unshaded) box its shape.
    if (this.state === "hit") {
      emissiveMaterial(235, 250, 255, fade);
      stroke(150, 240, 255, fade);
      strokeWeight(3);
    } else if (this.state === "missed") {
      emissiveMaterial(42, 44, 52, fade);
      stroke(78, 80, 92, fade);
      strokeWeight(1.5);
    } else {
      emissiveMaterial(178, 46, 86, fade);
      stroke(255, 140, 170, fade);
      strokeWeight(2);
    }
    box(this.size);

    this.drawCutMarker(half, fade);
    pop();
  }

  // The arrow (or dot) showing which way this block wants to be cut, drawn on
  // the face pointing at the camera (+z side). Assumes the caller has already
  // translated to the block's centre.
  //
  // These are 2D primitives, which in WEBGL run through the immediate-mode
  // shader and read fill() rather than the active material — so fill() is
  // correct here even though the box above uses emissiveMaterial().
  drawCutMarker(half, fade) {
    const angle = CUT_DIRECTIONS[this.cutDirection];

    noStroke();
    if (this.state === "hit") {
      fill(90, 120, 160, fade);
    } else {
      fill(255, 235, 240, fade);
    }

    push();
    // Sit 2 units in front of the face so the marker never z-fights the box.
    translate(0, 0, half + 2);

    // "any" has no direction to point, so it gets Beat Saber's dot instead.
    if (angle === null || angle === undefined) {
      circle(0, 0, 26);
    } else {
      // Arrow drawn pointing right, then rotated into place (rotateZ spins
      // about the local z axis, which is exactly the face normal here).
      rotateZ(angle);
      triangle(26, 0, -12, -20, -12, 20);
    }
    pop();
  }
}
