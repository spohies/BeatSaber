// sketch.js
//
// Main game loop, in WEBGL: spawn blocks deep in the scene, fly them at the
// camera down a neon track, and score slashes where they cross the hit plane.
//
//   phone -> bridge -> input.js -> Saber (3D aim point on the hit plane)
//                                  Block[] -> hit / miss -> score
//
// COORDINATES (p5 WEBGL): origin at screen centre, +x right, +y DOWN,
// +z toward the viewer. The default camera sits at (0, 0, ~0.87 × height)
// looking at the origin, which makes 1 world unit = 1 screen pixel on the
// z = 0 plane. Everything is designed around that plane:
//
//   z = SPAWN_Z (−3800)  blocks appear at the vanishing point
//   z = 0                the HIT PLANE — saber aim point lives here
//   z = DESPAWN_Z        blocks are gone
//
// LIGHTING: there is none, deliberately. Every 3D surface uses
// emissiveMaterial(), which ignores lights. See the note in block.js for why
// mixing fill()+lights with materials goes wrong in p5.
//
// The HUD is plain DOM (see index.html) updated from here each frame, not
// drawn into the canvas.
//
// Load order matters: p5, then input.js, saber.js, block.js, then this file.

// --- Tuning -----------------------------------------------------------------

const SLICE_SPEED = 12; // px/frame of aim-point motion that counts as a slice
const SPAWN_INTERVAL = 1100; // ms between block spawns
const POINTS_PER_HIT = 100;
const SLICE_FLASH_MS = 350;
// RECENTER_FLASH_MS lives in saber.js — these files share one global scope, so
// re-declaring a const here would throw and kill this whole script.

// World layout: a 4-wide × 2-tall grid of cells the blocks fly down, like
// Beat Saber's columns and rows.
const LANE_COUNT = 4;
const LANE_SPACING = 150; // world units between lane centres
const ROW_YS = [-30, 125]; // row centres; +y is down, so -30 is the TOP row
const TRACK_HALF_W = (LANE_COUNT / 2) * LANE_SPACING;
const FLOOR_Y = 320; // the neon grid floor

const SPAWN_Z = -3800; // where blocks appear (vanishing point)
const HIT_PLANE_Z = 0; // must match SABER_PLANE_Z in saber.js
const HIT_Z_TOLERANCE = 130; // ± world units around the hit plane that score

// Blocks are deleted here. This must stay WELL clear of the camera (which sits
// near z = +780 at a 900px window height). A block whose centre reaches even
// z = 650 is ~75 units from the eye, where its 110-unit cube projects to over
// 1100px — a screen-filling box for the frame before it despawns. Blocks also
// fade out before this point; see BLOCK_FADE_OUT_* in block.js.
const DESPAWN_Z = 220;

const BLOCK_SPEED = 26; // world units per frame (~2.5 s of travel at 60fps)

// Extra reach around a block's face: the saber has thickness, so grazing the
// edge should still count.
const SABER_HIT_PAD = 16;

const GRID_SPACING = 300; // gap between the floor's cross-lines

// --- State ------------------------------------------------------------------

let saber;
let blocks = [];
let lanes = []; // x centre of each lane (world units)

let ui = {}; // cached HUD element references, filled in setup()

let score = 0;
let combo = 0;
let bestCombo = 0;

let lastSpawn = 0; // millis() of the last spawn
let lastSliceAt = -Infinity; // millis() of the last successful hit

let scrollZ = 0; // floor cross-line animation, synced to block speed

let sliceSpeed = SLICE_SPEED; // live-tunable copy (arrow keys)
let showDebug = true;

// --- p5 lifecycle -----------------------------------------------------------

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  // Default fovY is PI/3, which is what makes z = 0 map 1:1 to pixels. Set it
  // explicitly with a far plane deep enough to hold the whole track.
  perspective(PI / 3, width / height, 40, 10000);

  // Lane centres, symmetric about x = 0: for 4 lanes, -225 -75 +75 +225.
  lanes = [];
  for (let i = 0; i < LANE_COUNT; i++) {
    lanes.push((i - (LANE_COUNT - 1) / 2) * LANE_SPACING);
  }

  ui = {
    score: document.getElementById("score"),
    combo: document.getElementById("combo"),
    conn: document.getElementById("conn"),
    sensor: document.getElementById("sensor"),
    speedfill: document.getElementById("speedfill"),
    flash: document.getElementById("flash"),
    recenter: document.getElementById("recenter"),
  };

  saber = new Saber(width / 2, height / 2);
  lastSpawn = millis();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  perspective(PI / 3, width / height, 40, 10000);
}

function draw() {
  background(8, 10, 18);

  drawTrack();

  // Saber updates before blocks so hit tests use this frame's aim point.
  saber.update();

  spawnIfDue();
  updateBlocks();

  saber.draw();
  updateHud();
}

// --- Spawning ---------------------------------------------------------------

function spawnIfDue() {
  if (millis() - lastSpawn < SPAWN_INTERVAL) return;
  lastSpawn = millis();
  blocks.push(new Block(random(lanes), random(ROW_YS), SPAWN_Z, BLOCK_SPEED));
}

// --- Update, hit detection, scoring -----------------------------------------

// Walk backwards so removing a block doesn't skip the next one.
function updateBlocks() {
  // Speed is measured on the aim point's own screen motion — a slice is a fast
  // flick, aiming is slow, and this threshold is the line between them.
  const slicing = saber.cursorSpeed > sliceSpeed;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    block.update();

    if (block.state === "incoming") {
      // A hit needs all three at once: the block is crossing the hit plane
      // (z window), the saber's path swept through its face (x/y bounds), and
      // the saber was moving fast enough to be a slice, not a rest.
      if (slicing && block.inHitZone(HIT_PLANE_Z, HIT_Z_TOLERANCE) && saberCrosses(block)) {
        registerHit(block);
      } else if (block.z > HIT_PLANE_Z + HIT_Z_TOLERANCE) {
        // Flew past the scoreable window without being cut.
        registerMiss(block);
      }
    }

    block.draw();

    if (block.isGone(DESPAWN_Z)) {
      blocks.splice(i, 1);
    }
  }
}

// Did the saber's aim point sweep through the block's face this frame?
//
// The aim point and the block both live near the hit plane, so this is a 2D
// test in the plane's x/y — the z overlap was already checked by inHitZone().
// Tested along the aim point's whole path this frame, not just its final
// position: a fast flick can jump 100+ px between frames and would otherwise
// tunnel straight through the block without scoring. The last sample is the
// current position, so this is a superset of the simple point-in-bounds test.
function saberCrosses(block) {
  const reach = block.size / 2 + SABER_HIT_PAD;
  const samples = 6;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = lerp(saber.prevTipX, saber.tipX, t);
    const y = lerp(saber.prevTipY, saber.tipY, t);
    if (Math.abs(x - block.x) <= reach && Math.abs(y - block.y) <= reach) {
      return true;
    }
  }
  return false;
}

function registerHit(block) {
  block.markHit();
  combo += 1;
  bestCombo = Math.max(bestCombo, combo);
  score += POINTS_PER_HIT * combo;
  lastSliceAt = millis();
}

function registerMiss(block) {
  block.state = "missed";
  combo = 0;
}

// --- Track rendering --------------------------------------------------------

// The neon environment: floor grid rushing past, rails converging on the
// vanishing point, a glowing frame marking the hit plane.
function drawTrack() {
  const railX = TRACK_HALF_W + 60;
  const nearZ = 500;

  // Longitudinal rails: magenta outer pair, dimmer cyan lane dividers. These
  // converge at the vanishing point and are what sells the perspective.
  strokeWeight(3);
  stroke(255, 70, 200, 190);
  line(-railX, FLOOR_Y, SPAWN_Z, -railX, FLOOR_Y, nearZ);
  line(railX, FLOOR_Y, SPAWN_Z, railX, FLOOR_Y, nearZ);

  strokeWeight(1.5);
  stroke(90, 200, 255, 70);
  for (let i = 0; i <= LANE_COUNT; i++) {
    const x = -TRACK_HALF_W + i * LANE_SPACING;
    line(x, FLOOR_Y, SPAWN_Z, x, FLOOR_Y, nearZ);
  }

  // Cross-lines slide toward the camera at block speed, wrapping every
  // GRID_SPACING — cheap, and it makes the whole floor feel like motion.
  scrollZ = (scrollZ + BLOCK_SPEED) % GRID_SPACING;
  stroke(90, 200, 255, 55);
  for (let z = nearZ - GRID_SPACING + scrollZ; z > SPAWN_Z; z -= GRID_SPACING) {
    line(-railX, FLOOR_Y, z, railX, FLOOR_Y, z);
  }

  // Glow at the vanishing point, so the track visibly "comes from" somewhere.
  push();
  translate(0, 60, SPAWN_Z);
  noStroke();
  emissiveMaterial(150, 120, 255, 60);
  sphere(260, 12, 8);
  emissiveMaterial(220, 210, 255, 170);
  sphere(120, 12, 8);
  pop();

  // The hit frame: a neon rectangle on the hit plane around the block grid.
  // This replaces the 2D version's hit line — slice blocks as they cross it.
  const top = ROW_YS[0] - BLOCK_SIZE;
  strokeWeight(3);
  stroke(120, 200, 255, 150);
  noFill();
  beginShape();
  vertex(-railX, top, HIT_PLANE_Z);
  vertex(railX, top, HIT_PLANE_Z);
  vertex(railX, FLOOR_Y, HIT_PLANE_Z);
  vertex(-railX, FLOOR_Y, HIT_PLANE_Z);
  endShape(CLOSE);
  noStroke();
}

// --- HUD (DOM) --------------------------------------------------------------

// Fixed-width number, so the readout doesn't jitter as digits change.
function fmt(n, decimals = 2, width = 7) {
  if (!Number.isFinite(n)) return "—".padStart(width);
  return n.toFixed(decimals).padStart(width);
}

function updateHud() {
  ui.score.textContent = `SCORE ${score}`;
  ui.combo.textContent = `COMBO ${combo}`;
  ui.combo.className = combo > 0 ? "" : "zero";

  updateSensorPanel();

  // Speed bar: fill relative to twice the threshold, so the tick at 50% is the
  // threshold itself.
  const frac = constrain(saber.cursorSpeed / (sliceSpeed * 2), 0, 1);
  ui.speedfill.style.width = `${frac * 100}%`;
  ui.speedfill.className = saber.cursorSpeed > sliceSpeed ? "slicing" : "";

  // Flashes: linear fade-out driven from the timestamps.
  const sinceSlice = millis() - lastSliceAt;
  ui.flash.style.opacity =
    sinceSlice < SLICE_FLASH_MS ? String(1 - sinceSlice / SLICE_FLASH_MS) : "0";

  const sinceRecenter = millis() - saber.recenteredAt;
  ui.recenter.style.opacity =
    sinceRecenter < RECENTER_FLASH_MS ? String(1 - sinceRecenter / RECENTER_FLASH_MS) : "0";
}

// The panel to watch while waving the phone around. Raw numbers first, derived
// numbers second, so you can tell at a glance WHERE the chain is broken:
//
//   packets not climbing        -> bridge or phone (check the hotspot, not eduroam)
//   packets climbing, quat "—"  -> bridge is fine; ZIG SIM isn't sending quaternion
//   quat moving, yaw/pitch flat -> the maths in input.js
//   yaw/pitch moving, aim flat  -> sensitivity or deadzone in saber.js
function updateSensorPanel() {
  const diag = getDiagnostics();
  const state = getSensorState();
  const aim = getPointer();

  ui.conn.textContent = diag.connected ? "● bridge connected" : "○ waiting for bridge";
  ui.conn.className = diag.connected ? "ok" : "bad";

  const [qw, qx, qy, qz] = state.quaternion;
  const lines = [];

  lines.push(`packets ${String(diag.messageCount).padStart(7)}  ${fmt(diag.messageRate, 1, 6)}/s`);

  if (!diag.hasQuaternion) {
    lines.push("quat    NO QUATERNION STREAM");
    // The addresses actually arriving are the fastest way to see which sensors
    // ZIG SIM has enabled.
    const seen = diag.seen.slice(0, 5);
    lines.push(seen.length ? "seen:" : "seen:   (nothing yet)");
    for (const address of seen) lines.push(`  ${address}`);
  } else {
    lines.push(`quat w ${fmt(qw, 3, 7)}  x ${fmt(qx, 3, 7)}`);
    lines.push(`     y ${fmt(qy, 3, 7)}  z ${fmt(qz, 3, 7)}`);
  }

  lines.push(`gyro |w| ${fmt(state.gyroMag, 2, 6)}  rad/s`);
  lines.push(
    `accel ${fmt(state.accel.x, 2, 6)} ${fmt(state.accel.y, 2, 6)} ${fmt(state.accel.z, 2, 6)}`
  );
  lines.push("");
  lines.push(`yaw   ${fmt(degrees(aim.yaw), 1, 7)}°`);
  lines.push(`pitch ${fmt(degrees(aim.pitch), 1, 7)}°`);
  lines.push(`roll  ${fmt(degrees(aim.roll), 1, 7)}°`);
  lines.push("");
  lines.push(`aim   ${fmt(saber.tipX, 0, 6)} ${fmt(saber.tipY, 0, 6)} px`);
  lines.push(`speed ${fmt(saber.cursorSpeed, 1, 6)} px/f`);

  if (showDebug) {
    lines.push("");
    lines.push(`slice   ${fmt(sliceSpeed, 1, 6)}  (↑/↓)`);
    lines.push(`deg/scr ${fmt(saber.degreesPerScreenX, 0, 6)}  ([/])`);
    lines.push(`cutoff  ${fmt(saber.minCutoff, 2, 6)}  (-/=)`);
    lines.push(`best    ${String(bestCombo).padStart(6)}`);
    lines.push("c: recenter · d: less info");
  }

  ui.sensor.textContent = lines.join("\n");
}

// --- Input ------------------------------------------------------------------

function keyPressed() {
  // Arrow keys retune the slice threshold live, the way they retuned the swing
  // threshold in the Phase 0 monitor.
  if (keyCode === UP_ARROW) sliceSpeed += 1;
  if (keyCode === DOWN_ARROW) sliceSpeed = Math.max(0, sliceSpeed - 1);
  if (key === "d" || key === "D") showDebug = !showDebug;
  if (key === "c" || key === "C") saber.recenter();

  // Saber feel: [ ] widen/narrow the rotation needed to cross the screen,
  // - = trade steadiness against lag.
  if (key === "[") saber.adjustDegreesPerScreen(-10);
  if (key === "]") saber.adjustDegreesPerScreen(10);
  if (key === "-") saber.adjustMinCutoff(-0.1);
  if (key === "=") saber.adjustMinCutoff(0.1);
}
