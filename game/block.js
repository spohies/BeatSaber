// block.js
//
// One falling block — the thing you slice.
//
// A block spawns off the top of the screen in a lane, falls at a fixed speed,
// and is scoreable during the window where it overlaps the hit line. The main
// loop owns that decision; a block only reports where it is and what it wants.
//
// No sensor dependency — this file is pure p5 drawing and arithmetic.

// --- Tuning -----------------------------------------------------------------

const BLOCK_SIZE = 64; // width and height, pixels
const BLOCK_CORNER = 12; // corner radius

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
  // x is the lane's centre; speed is pixels per frame.
  constructor(x, speed) {
    this.x = x;
    this.speed = speed;

    // Start fully off-screen so blocks slide in rather than popping into view.
    this.y = -BLOCK_SIZE;

    this.size = BLOCK_SIZE;
    this.state = "incoming"; // "incoming" | "hit" | "missed"
    this.cutDirection = "any"; // Phase 2 will vary this per beat-map note
  }

  update() {
    this.y += this.speed;
  }

  // True while the block overlaps the scoreable window around the hit line.
  inHitZone(hitLineY, tol) {
    return Math.abs(this.y - hitLineY) <= tol;
  }

  // True once the block has fallen entirely past the bottom of the screen.
  isOffScreen(screenHeight) {
    return this.y - this.size > screenHeight;
  }

  draw() {
    const half = this.size / 2;

    push();
    translate(this.x, this.y);

    // Face and edge colour carry the state: neutral while live, bright on a
    // successful slice, dim and desaturated once missed.
    if (this.state === "hit") {
      fill(255, 255, 255);
      stroke(150, 240, 255);
      strokeWeight(4);
    } else if (this.state === "missed") {
      fill(48, 50, 58);
      stroke(70, 72, 82);
      strokeWeight(2);
    } else {
      fill(198, 62, 98);
      stroke(255, 140, 170);
      strokeWeight(3);
    }
    rect(-half, -half, this.size, this.size, BLOCK_CORNER);

    this.drawCutMarker();
    pop();
  }

  // The arrow (or dot) showing which way this block wants to be cut. Assumes
  // the caller has already translated to the block's centre.
  drawCutMarker() {
    const angle = CUT_DIRECTIONS[this.cutDirection];
    const ink = this.state === "hit" ? color(90, 120, 160) : color(255, 235, 240);

    noStroke();
    fill(ink);

    // "any" has no direction to point, so it gets Beat Saber's dot instead.
    if (angle === null || angle === undefined) {
      circle(0, 0, 14);
      return;
    }

    // Arrow drawn pointing right, then rotated into place.
    push();
    rotate(angle);
    triangle(14, 0, -6, -11, -6, 11);
    pop();
  }
}
