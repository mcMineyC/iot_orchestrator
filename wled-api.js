import WebSocket from "ws";
import { EventEmitter } from "node:events";

import process from 'process';
process.stdin.resume(); // Keeps process alive

export const compare = (a, b) =>
  typeof a === "object" || typeof b === "object"
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;
export const isDiff = (a, b) => !compare(a, b);
export const mapNumRange = (num, inMin, inMax, outMin, outMax) =>
  ((num - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
export const withinTolerance = (val, tar, tol) => val <= tar+tol && val >= tar-tol

export const clamp = (val, min, max) => Math.min(Math.max(val, min), max);


export class WledApi extends EventEmitter {
  #power = null;
  #brightness = null;
  #presets = null;
  #preset = null;
  #segments = [];
  #state = null;
  constructor(host) {
    super();

    // Shenanaginry to make sure segments and presets are fetched
    this.inited = {
      presets: {},
      segments: {}
    }
    var prom = new Promise((resolve, reject) => {this.inited.segments.resolve = resolve; this.inited.segments.reject = reject})
    this.inited.segments.promise = prom // The promise needs to be set up, then resolved in another setter
    this.inited.presets.promise = this.fetchPresets(host);

    // Connect to WLED websocket
    this.ws = new WebSocket(`ws://${host}/ws`);
    this.ws.on("open", function open() {
      console.log("[[WLED]]: Connected to " + host);
    });
    this.ws.on("message", (data) => {
      // console.log("New message!!!");
      try {
        var msg = JSON.parse(data);
        // fs.writeFileSync("./wled-message.json", JSON.stringify(msg,null,2))
        // if (typeof msg.success !== "undefined" && msg.success === true)
        //   console.log("Command completed successfully");
        // else if (typeof msg.success !== "undefined" && msg.success === false)
        //   console.log("Command failed");

        if (typeof msg.state !== "undefined") {
          this.state = msg.state;
        }
      } catch (e) {
        console.log("Failed to parse state:", e);
      }
    });
  }
  init(){
    return Promise.all([this.inited.segments.promise, this.inited.presets.promise])
  }
  async fetchPresets(host) {
    // console.log("Fetching presets from instance");
    const response = await fetch(`http://${host}/presets.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const presets = await response.json();
    var presetList = [];
    Object.values(presets).forEach((preset, index) => {
      presetList.push({
        brightness: preset.bri,
        id: index,
        name: preset.n || `Preset ${index + 1}`,
      });
    });
    // console.log("Fetched presets:", presetList.length);
    this.#_presets = presetList
    return presetList;
  }

  set #_power(on){
    if (on !== this.#power)
      this.emit("power", on);
    this.#power = on;
  }
  set #_brightness(bri){
    if(bri !== this.#brightness)
      this.emit("brightness", bri);
    this.#brightness = bri;
  }
  set #_presets(psl){
    if(isDiff(psl, this.#presets))
      this.emit("presets", psl)
    this.#presets = psl
  }
  set #_preset(ps){
    if(ps !== this.#preset)
      this.emit("preset", ps)
    this.#preset = ps
  }

  #updateSegments(segs) {
    segs.forEach((seg, index) => {
      if (this.#segments.length <= index) {
        this.#segments.push(new WledSegment(this.ws, seg));
      } else {
        this.#segments[index].state = seg;
      }
    });
    this.inited.segments.resolve()
  }

  set state(s) {
    if (isDiff(this.#state, s)) {
      console.log("State updated")
      this.#_power = s.on
      this.#_brightness = s.bri
      this.#_preset = s.ps
      this.#updateSegments(s.seg);
      this.#state = s;
      this.emit("state", s);
    }
  }
  get state() {
    return this.#state;
  }

  set power(on){
    this.sendMessage({on})
  }
  get power(){
    return this.#power
  }

  set brightness(bri){
    this.sendMessage({bri})
  }
  get brightness(){
    return this.#brightness
  }

  set preset(ps){
    this.sendMessage({ps})
  }
  get preset(){
    return this.#preset
  }

  get segments() {
    return this.#segments;
  }

  sendMessage(msg){
    this.ws.send(JSON.stringify(msg))
  }
}

export class WledSegment extends EventEmitter {
  #id = null;
  #name = null;
  #power = null;
  #brightness = null;
  #temperature = null;
  #color = null;
  #effect = null;
  #currentState = null;

  constructor(ws, state) {
    super()
    this.ws = ws;
    this.state = state;
  }

  // Setters & getters
  get id() {
    return this.#id;
  }

  set state(state) {
    this.#id = state.id
    this.#name = state.n;

    // console.log("Segment %d state", this.#id, state)


    if (state.on !== this.#power)
      this.emit("power", state.on);
    this.#power = state.on;

    if (state.bri, this.#brightness)
      this.emit("brightness", state.bri);
    this.#brightness = state.bri;

    // var newTemp = colorConv.rgb2colorTemperature(state.col[0])
    var col = state.col[0]
    var newTemp = Math.ceil(rgbToKelvin({r: col[0], g: col[1], b: col[2]}))
    if (!withinTolerance(newTemp, this.#temperature, 2))
      this.emit("temperature", newTemp)
    this.#temperature = newTemp;

    if(isDiff(state.col[0], this.#color))
      this.emit("color", state.col[0])
    this.#color = state.col[0]

    if(state.fx !== this.#effect)
      this.emit("effect", state.fx)
    this.#effect = state.fx

    if (this.#currentState === null || isDiff(state, this.#currentState)) {
      this.#currentState = state;
      this.emit("state", state);
    }
  }
  get state() {
    return this.#currentState;
  }

  set name(n) {
    if (compare(n, this.#name)) return;
    this.sendMessage({ n: n });
    this.emit("name", n);
  }
  get name() {
    return this.#name;
  }

  set power(on) {
    if (compare(on, this.#power)) return;
    this.sendMessage({ on });
    this.emit("power", on);
  }
  get power() {
    return this.#power;
  }

  set brightness(bri) {
    if (compare(bri, this.#brightness)) return;
    this.sendMessage({ bri });
    this.emit("brightness", bri);
  }
  get brightness() {
    return this.#brightness;
  }

  set temperature(cct) {
    // console.log("Asking for temperature %d (cct %d\%)", cctAsK, cct)
    if (compare(cct, this.#temperature)) return;
    var rgbVal = kelvinToRgb(cct)
    this.sendMessage({fx:0, col: [[rgbVal.r, rgbVal.g, rgbVal.b]]});
    this.emit("temperature", cct);
    this.#temperature = cct
  }
  get temperature() {
    return this.#temperature
    // return mapNumRange(this.#temperature, 0, 255, 2700, 6500);
  }

  set color(col) {
    if(typeof col.length === "undefined")
      throw "Color must be array in form [r, g, b]"
    if(compare(col, this.#color)) return;
    this.sendMessage({fx: 0, col: [col]})
    this.emit("color", col)
  }
  get color(){
    return this.#color
  }

  set effect(fx) {
    if(compare(fx, this.#effect)) return;
    this.sendMessage({fx})
    this.emit("effect", fx)
  }
  get effect(){
    return this.#effect
  }

  sendMessage(state) {
    this.ws.send(JSON.stringify({ seg: [{ ...state, id: this.#id }] }));
  }
}

// Courtesy of Iro.js
// Url: https://github.com/irojs/iro-core/blob/typescript/src/color.ts#L299
function kelvinToRgb(kelvin) {
    const temp = kelvin / 100;
    let r, g, b;
    if (temp < 66) {
      r = 255
      g = -155.25485562709179 - 0.44596950469579133 * (g = temp-2) + 104.49216199393888 * Math.log(g)
      b = temp < 20 ? 0 : -254.76935184120902 + 0.8274096064007395 * (b = temp-10) + 115.67994401066147 * Math.log(b)
    } else {
      r = 351.97690566805693 + 0.114206453784165 * (r = temp-55) - 40.25366309332127 * Math.log(r)
      g = 325.4494125711974 + 0.07943456536662342 * (g = temp-50) - 28.0852963507957 * Math.log(g)
      b = 255
    }
    return {
      r: clamp(Math.floor(r), 0, 255),
      g: clamp(Math.floor(g), 0, 255),
      b: clamp(Math.floor(b), 0, 255)
    };
  }

function rgbToKelvin(rgb) {
    const { r, g, b } = rgb;
    const eps = 0.4;
    let minTemp = 2000;
    let maxTemp = 40000;
    let temp;
    while (maxTemp - minTemp > eps) {
      temp = (maxTemp + minTemp) * 0.5;
      const rgb = kelvinToRgb(temp);
      if ((rgb.b / rgb.r) >= (b / r)) {
        maxTemp = temp;
      } else {
        minTemp = temp;
      }
    }
    return temp;
  }

