// sketch.js
//
// A minimal p5.js monitor for phone sensor data relayed by the WebSocket bridge.
//
//   bridge (ws://localhost:8081)  -->  this page
//
// The bridge forwards each OSC message as JSON: { address, args }.
// We keep the latest args for every address and render them live.

// --- WebSocket state --------------------------------------------------------

const WS_URL = "ws://localhost:8081";

let socket = null; // current WebSocket instance
let connected = false; // true while the socket is open

// Latest args keyed by OSC address, e.g. { "/ZIGSIM/accel": [0.1, -0.9, 0.2] }.
// We use a plain object and read its keys each frame in draw().
const latest = {};

// Open (or re-open) the WebSocket and wire up its handlers.
function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected = true;
    console.log("WebSocket connected");
  };

  socket.onmessage = (event) => {
    // Each message is a JSON { address, args } object from the bridge.
    try {
      const data = JSON.parse(event.data);
      if (data && data.address) {
        // Store the most recent args for this address (replace, don't append).
        latest[data.address] = data.args;
      }
    } catch (err) {
      console.error("Bad message:", err);
    }
  };

  socket.onclose = () => {
    connected = false;
    console.log("WebSocket closed — retrying in 1s");
    // Auto-reconnect after a short delay.
    setTimeout(connect, 1000);
  };

  socket.onerror = () => {
    // An error is normally followed by onclose, which handles the retry.
    // Close here to be safe in case the socket is left half-open.
    if (socket) socket.close();
  };
}

// --- p5.js lifecycle --------------------------------------------------------

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  connect();
}

// Keep the canvas filling the window when it's resized.
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background(17); // matches the page's dark #111

  const margin = 20;
  let y = margin + 20;

  // --- Connection status line ---
  if (connected) {
    fill(80, 220, 120); // green
    textSize(18);
    text("● connected to " + WS_URL, margin, y);
  } else {
    fill(220, 180, 80); // amber
    textSize(18);
    text("○ waiting for bridge at " + WS_URL + " ...", margin, y);
  }

  y += 36;

  // --- Address list with latest values ---
  textSize(14);

  const addresses = Object.keys(latest).sort();

  if (addresses.length === 0) {
    fill(140);
    text("(no sensor data yet)", margin, y);
    return;
  }

  for (const address of addresses) {
    const args = latest[address];

    // Format each arg: numbers to 3 decimals, anything else as-is.
    const formatted = (Array.isArray(args) ? args : [args])
      .map((v) => (typeof v === "number" ? v.toFixed(3) : String(v)))
      .join("  ");

    fill(120, 200, 255); // address in blue
    text(address, margin, y);

    fill(230); // values in light grey
    text(formatted, margin + 280, y);

    y += 22;
  }
}
