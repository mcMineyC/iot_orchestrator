import process from 'process';
process.stdin.resume(); // Keeps process alive

import {WledApi} from "./wled-api.js"

const TEMP_MIN = 2000;
const TEMP_MAX = 7000;

const wled = new WledApi("192.168.30.30")
await wled.init()
wled.on("state", (state) => {
  console.log("Current state is %s, preset %s", state.on ? "ON" : "OFF", state.ps)
})
console.log("There are", wled.segments.length, "segments")
wled.segments.forEach((seg) => seg.on("power", (power) => {
  console.log("Segment",seg.id,"("+seg.name+")", "is", power ? "on" : "off")}))
wled.on("brightness", (bri) => console.log("New brightness is %d", bri))
wled.segments[3].on("temperature", (t) => {
  console.log("Desk light changed to %d", t)
})
wled.segments[4].on("color", (c) => {console.log("Deks light color changed", c)})
wled.segments[3].temperature = 5000 
wled.segments[2].color = [0,255,255]
wled.segments[5].brightness = 200
wled.segments[1].power = false
wled.segments[0].power = true
