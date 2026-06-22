# Phone Remote Rhythm Game

A Beat Saber–style rhythm game phones act as the sabers.
Phone motion is captured with the ZIG SIM app, streamed over OSC, and rendered in a p5.js game in the browser.

## Stack
- ZIG SIM (phone IMU → OSC over UDP)
- Node.js bridge (OSC → WebSocket)
- p5.js (game + rendering)

## Status
🚧 In development!

## Structure
- `bridge/` — Node relay that forwards phone data to the browser
- `game/`   — the p5.js game

## Running it locally
... tbd lol