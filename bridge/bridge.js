// bridge.js
//
// A small relay that sits between the ZIG SIM phone app and a browser.
//
//   ZIG SIM (phone)  --OSC/UDP-->  this bridge  --WebSocket/JSON-->  browser
//
// ZIG SIM sends sensor data as OSC messages over UDP. Browsers can't open a
// raw UDP socket, so this process listens for those OSC packets and re-broadcasts
// each one to every connected browser as a simple JSON object.

const osc = require("osc"); // OSC over UDP
const WebSocket = require("ws"); // WebSocket server for browsers

// --- Configuration ----------------------------------------------------------

const OSC_PORT = 5000; // UDP port ZIG SIM sends OSC messages to
const OSC_HOST = "0.0.0.0"; // bind to all interfaces so phones on the LAN can reach us
const WS_PORT = 8081; // TCP port browsers connect to over WebSocket

// Track which OSC addresses we've already seen, so we can log each unique
// address exactly once (ZIG SIM sends the same addresses many times a second).
const seenAddresses = new Set();

// --- WebSocket server (browser side) ----------------------------------------

// Create the WebSocket server that browser clients connect to.
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on("listening", () => {
  console.log(`[ws]  WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on("connection", (socket, req) => {
  // req.socket.remoteAddress tells us which client connected.
  const who = req.socket.remoteAddress;
  console.log(`[ws]  Browser connected (${who}). Clients: ${wss.clients.size}`);

  socket.on("close", () => {
    console.log(`[ws]  Browser disconnected (${who}). Clients: ${wss.clients.size}`);
  });

  // A per-client error shouldn't take down the whole bridge.
  socket.on("error", (err) => {
    console.error(`[ws]  Client error (${who}):`, err.message);
  });
});

wss.on("error", (err) => {
  console.error("[ws]  Server error:", err.message);
});

// Helper: send a payload to every connected, open browser client.
function broadcast(payload) {
  const json = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// --- OSC / UDP server (phone side) ------------------------------------------

// Open a UDP socket to receive OSC messages from ZIG SIM.
const udp = new osc.UDPPort({
  localAddress: OSC_HOST,
  localPort: OSC_PORT,
  metadata: false, // args come through as plain values, not {type, value} objects
});

udp.on("ready", () => {
  console.log(`[osc] Listening for ZIG SIM OSC on udp://${OSC_HOST}:${OSC_PORT}`);
});

// Fired for every OSC message that arrives.
udp.on("message", (oscMsg) => {
  const { address, args } = oscMsg;

  // Log the first time we ever see a given OSC address. This makes it easy to
  // discover what ZIG SIM is actually sending without flooding the console.
  if (!seenAddresses.has(address)) {
    seenAddresses.add(address);
    console.log(`[osc] New address seen: ${address}  (args: ${JSON.stringify(args)})`);
  }

  // Forward to all browsers in the agreed-upon shape.
  broadcast({ address, args });
});

udp.on("error", (err) => {
  console.error("[osc] Error:", err.message);
});

// Start the UDP socket.
udp.open();

console.log("Bridge starting up...");
