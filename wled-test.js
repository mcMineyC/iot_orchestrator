import {WledApi} from "./wled-api.js"
const wled = new WledApi("192.168.30.30")
await wled.init()
console.log("WLED inited")
wled.on("state", (state) => {
  console.log("Current state is %s, preset %s", state.on ? "ON" : "OFF", state.ps)
})
console.log("There are", wled.segmentslength, "segments")
wled.segments.forEach((seg) => seg.on("power", (power) => {
  console.log("Segment",seg.id,"("+seg.name+")", "is", power ? "on" : "off")}))
