// sketch.js
//
// Main game loop: spawn blocks, track where the phone is pointing, score the slashes.
//
//   phone -> bridge -> input.js -> Pointer (screen cursor)
//                                  Block[] -> hit / miss -> score
//
// Load order matters: p5, then input.js, saber.js, block.js, then this file.

// --- Tuning -----------------------------------------------------------------

const SLICE_SPEED = 12; // px/frame of cursor motion that counts as a slice
const SPAWN_INTERVAL = 1200; // ms between block spawns
const LANE_COUNT = 4;
const BLOCK_SPEED = 4; // pixels per frame

const HIT_TOLERANCE = 55; // ± pixels around the hit line that can be scored
const POINTS_PER_HIT = 100;
const SLICE_FLASH_MS = 350; // how long "SLICE!" stays on screen

// --- State ------------------------------------------------------------------

let pointer;
let blocks = [];
let lanes = []; // x centre of each lane
let hitLineY = 0;

let score = 0;
let combo = 0;
let bestCombo = 0;

let lastSpawn = 0; // millis() of the last spawn
let lastSliceAt = -Infinity; // millis() of the last successful hit

let sliceSpeed = SLICE_SPEED; // live-tunable copy (arrow keys)
let showDebug = true;

// --- Layout -----------------------------------------------------------------

// Lane positions and the hit line derive from the window size, so this runs on
// startup and again on every resize.
function layout() {
  hitLineY = height - 160;

  lanes = [];
  const laneWidth = width / (LANE_COUNT + 1);
  for (let i = 1; i <= LANE_COUNT; i++) {
    lanes.push(laneWidth * i);
  }
}

// --- p5 lifecycle -----------------------------------------------------------

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  layout();
  pointer = new Pointer(width / 2, height / 2);
  lastSpawn = millis();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
}

function draw() {
  background(17);

  drawLanes();
  drawHitLine();

  // Pointer updates before blocks so hit tests use this frame's cursor position.
  pointer.update();

  spawnIfDue();
  updateBlocks();

  pointer.draw();
  drawHud();
}

// --- Spawning ---------------------------------------------------------------

function spawnIfDue() {
  if (millis() - lastSpawn < SPAWN_INTERVAL) return;
  lastSpawn = millis();
  blocks.push(new Block(random(lanes), BLOCK_SPEED));
}

// --- Update, hit detection, scoring -----------------------------------------

// Walk backwards so removing a block doesn't skip the next one.
function updateBlocks() {
  // Speed is measured on the cursor's own screen motion — the gyro no longer
  // gates hits at all.
  const slicing = pointer.cursorSpeed > sliceSpeed;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    block.update();

    if (block.state === "incoming") {
      if (slicing && block.inHitZone(hitLineY, HIT_TOLERANCE) && pointerCrosses(block)) {
        registerHit(block);
        blocks.splice(i, 1);
        continue;
      }

      // Fallen past the scoreable window without being cut.
      if (block.y > hitLineY + HIT_TOLERANCE) {
        registerMiss(block);
      }
    }

    block.draw();

    if (block.isOffScreen(height)) {
      blocks.splice(i, 1);
    }
  }
}

// Is the pointer inside the block's bounds? Tested along the cursor's whole path
// this frame, not just its final position: a fast flick can jump 100+ px between
// frames and would otherwise tunnel straight through the block without scoring.
// The last sample is the current position, so this is a superset of the simple
// point-in-bounds test.
function pointerCrosses(block) {
  const half = block.size / 2;
  const samples = 6;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = lerp(pointer.prevX, pointer.x, t);
    const y = lerp(pointer.prevY, pointer.y, t);
    if (Math.abs(x - block.x) <= half && Math.abs(y - block.y) <= half) {
      return true;
    }
  }
  return false;
}

function registerHit(block) {
  block.state = "hit";
  combo += 1;
  bestCombo = Math.max(bestCombo, combo);
  score += POINTS_PER_HIT * combo;
  lastSliceAt = millis();
}

function registerMiss(block) {
  block.state = "missed";
  combo = 0;
}

// --- Rendering --------------------------------------------------------------

function drawLanes() {
  stroke(32, 34, 42);
  strokeWeight(1);
  for (const x of lanes) {
    line(x, 0, x, height);
  }
}

function drawHitLine() {
  // The scoreable band, then the line itself.
  noStroke();
  fill(255, 255, 255, 8);
  rect(0, hitLineY - HIT_TOLERANCE, width, HIT_TOLERANCE * 2);

  stroke(120, 200, 255, 160);
  strokeWeight(2);
  line(0, hitLineY, width, hitLineY);
}

function drawHud() {
  noStroke();

  fill(235);
  textSize(28);
  textAlign(LEFT, TOP);
  text(`SCORE ${score}`, 24, 24);

  fill(combo > 0 ? color(120, 220, 255) : color(120));
  textSize(20);
  text(`COMBO ${combo}`, 24, 60);

  // Always-visible help: recentering is the one control a player must know about.
  fill(130);
  textSize(14);
  text("press C to recenter pointer", 24, 92);

  // Brief centred flash on a successful slice.
  const sinceSlice = millis() - lastSliceAt;
  if (sinceSlice < SLICE_FLASH_MS) {
    const fade = 1 - sinceSlice / SLICE_FLASH_MS;
    fill(255, 255, 255, 255 * fade);
    textSize(52);
    textAlign(CENTER, CENTER);
    text("SLICE!", width / 2, height * 0.35);
  }

  if (showDebug) drawDebug();
}

// Live sensor readout — this is what you tune the thresholds against.
function drawDebug() {
  const state = getSensorState();
  const aim = getPointer();

  textAlign(RIGHT, TOP);
  textSize(14);

  fill(state.connected ? color(80, 220, 120) : color(220, 180, 80));
  text(state.connected ? "● bridge connected" : "○ waiting for bridge", width - 24, 24);

  fill(aim.valid ? color(160) : color(220, 120, 120));
  text(aim.valid ? "quaternion ok" : "no quaternion", width - 24, 46);

  fill(160);
  text(`pointer ${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)}`, width - 24, 64);
  text(`yaw ${degrees(aim.yaw).toFixed(1)}°  pitch ${degrees(aim.pitch).toFixed(1)}°`, width - 24, 82);
  text(`cursorSpeed ${pointer.cursorSpeed.toFixed(1)} px/f`, width - 24, 100);
  text(`slice speed ${sliceSpeed.toFixed(1)}  (↑/↓)`, width - 24, 118);
  text(`deg/screen ${pointer.degreesPerScreenX.toFixed(0)}°  ([/])`, width - 24, 136);
  text(`minCutoff ${pointer.minCutoff.toFixed(2)}  (-/=)`, width - 24, 154);
  text(`best combo ${bestCombo}`, width - 24, 172);
  text("c: recenter  ·  d: hide debug", width - 24, 190);

  // Bar showing cursorSpeed against the slice threshold — flick and watch it
  // cross the centre tick. This is what you tune SLICE_SPEED against.
  const barW = 180;
  const x = width - 24 - barW;
  noStroke();
  fill(40);
  rect(x, 212, barW, 8, 4);
  fill(pointer.cursorSpeed > sliceSpeed ? color(120, 240, 160) : color(90, 130, 190));
  rect(x, 212, constrain(pointer.cursorSpeed / (sliceSpeed * 2), 0, 1) * barW, 8, 4);
  fill(230);
  rect(x + barW / 2 - 1, 208, 2, 16);
}

// --- Input ------------------------------------------------------------------

function keyPressed() {
  // Arrow keys retune the slice threshold live, the way they retuned the swing
  // threshold in the Phase 0 monitor.
  if (keyCode === UP_ARROW) sliceSpeed += 1;
  if (keyCode === DOWN_ARROW) sliceSpeed = Math.max(0, sliceSpeed - 1);
  if (key === "d" || key === "D") showDebug = !showDebug;
  if (key === "c" || key === "C") pointer.recenter();

  // Pointer feel: [ ] widen/narrow the rotation needed to cross the screen,
  // - = trade cursor steadiness against lag.
  if (key === "[") pointer.adjustDegreesPerScreen(-10);
  if (key === "]") pointer.adjustDegreesPerScreen(10);
  if (key === "-") pointer.adjustMinCutoff(-0.1);
  if (key === "=") pointer.adjustMinCutoff(0.1);
}
