import WebSocket from "ws";
import { EventEmitter } from "node:events";

export const compare = (a, b) =>
  typeof a === "object" || typeof b === "object"
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;
export const isDiff = (a, b) => !compare(a, b);
export const mapNumRange = (num, inMin, inMax, outMin, outMax) =>
  ((num - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;

export class WledApi extends EventEmitter {
  #power = null;
  #brightness = null;
  #preset = null;
  #segments = [];
  #state = null;
  constructor(host) {
    super();
    this.inited = {}
    var prom = new Promise((resolve, reject) => {this.inited.resolve = resolve; this.inited.reject = reject})
    this.inited.promise = prom // The promise needs to be set up, then resolved in another setter
    this.ws = new WebSocket(`ws://${host}/ws`);
    this.ws.on("open", function open() {
      console.log("[[WLED]]: Connected to " + host);
    });
    this.ws.on("message", (data) => {
      console.log("New message!!!");
      try {
        var msg = JSON.parse(data);
        if (typeof msg.success !== "undefined" && msg.success === true)
          console.log("Command completed successfully");
        else if (typeof msg.success !== "undefined" && msg.success === false)
          console.log("Command failed");

        if (typeof msg.state !== "undefined") {
          this.state = msg.state;
        }
      } catch (e) {
        console.log("Failed to parse state:", e);
      }
    });
  }
  init(){
    return this.inited.promise
  }

  #updateSegments(segs) {
    segs.forEach((seg, index) => {
      if (this.#segments.length <= index) {
        this.#segments.push(new WledSegment(this.ws, seg));
      } else {
        this.#segments[index].state = seg;
      }
    });
    this.inited.resolve()
  }

  set state(s) {
    if (isDiff(this.#state, s)) {
      console.log("State updated")
      this.#power = s.on;
      this.#brightness = s.bri;
      this.#preset = s.ps;
      this.#updateSegments(s.seg);
      this.emit("state", s);
      console.log("Emitted???")
    }
    this.#state = s;
  }
  get state() {
    return this.#state;
  }

  set power(on){

  }
  get power(){
    return this.#power
  }

  set brightness(bri){

  }
  get brightness(){
    return this.#brightness
  }

  set preset(ps){
    
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
    this.#id = state.id;
    this.#name = state.n;


    if (state.on !== this.#power)
      this.emit("power", state.on);
    this.#power = state.on;

    if (state.bri, this.#brightness)
      this.emit("brightness", state.bri);
    this.#brightness = state.bri;

    if (isDiff(state.cct, this.#temperature))
      this.emit("temperature", state.cct)
    this.#temperature = state.cct;

    if (this.#currentState === null || isDiff(state, this.#currentState)) {
      console.log("Segment", this.#id, "state updated")
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
    if (compare(cct, this.#temperature)) return;
    this.sendMessage(cct);
    this.emit("temperature", cct);
  }
  get temperature() {
    return mapNumRange(this.#temperature, 0, 255, 2700, 6500);
  }

  sendMessage(state) {
    this.ws.send(JSON.stringify({ seg: [{ ...state, id: this.#id }] }));
  }
}
