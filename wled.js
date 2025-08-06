import {WledApi} from "./wled-api.js"
import Integration from "./integration-base.js";
console.log("Starting up...")
var integration = new Integration("wled");
console.log("[[WLED]] Connecting to", integration.params.host)
const wled = new WledApi(integration.params.host);
await wled.init() // Fetches presets and wledments
console.log("Connected to bus and WLED instance")


//////////////////////////
///  data fetch logic  ///
/////////////////////////
integration.fetchers = {
  "/powerState": () => {console.log("Sending powerState"); return wled.power ? "on" : "off"},
  "/lightState": async () => {
    console.log("Sending lightState")
    var tempState = getLightState();
    console.log("We have %d presets", wled.presets.length);
    // if (tempState.preset > 0 && tempState.preset < presets.length) {
    //   tempState.presetName = presets[tempState.preset].name;
    // }else{
    //   console.warn("Preset index out of bounds, using empty name");
    // }
    return tempState;
  },
  "/presets": async () => {console.log("Sending presets"); return await wled.cachedPresets()},
}

//////////////////////////
/// command definition ///
/////////////////////////

integration.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  "/power/on": (topic, message) => {
    console.log("Powering on!");
    wled.power = true
    return {
      path: `/powerState`,
      data: "on",
    };
  },
  "/power/off": (topic, message) => {
    console.log("Powering off!");
    wled.power = false
    return {
      path: `/powerState`,
      data: "off",
    };
  },
  "/power/toggle": (topic, message) => {
    console.log("Toggling power!");
    var pow = !wled.power
    wled.power = pow
    return {
      path: `/powerState`,
      data: wled.power ? "off" : "on",
    };
  },
  "/light/brightness": (topic, message) => {
    console.log("Setting brightness!");
    if (typeof message == "number" && message >= 0 && message <= 255) {
      if (integration.params.maxBrightness) {
        message = Math.round((message / 255) * integration.params.maxBrightness);
      }
      wled.brightness = message
      return {
        path: `/lightState`,
        data: getLightState(),
      };
    } else {
      return {
        path: `/error`,
        data: `Invalid brightness.  Expected number in range 0 to 255, got (${typeof message}) ${message}`,
      };
    }
  },
  "/light/preset": (topic, message) => {
    console.log("Setting preset!");
    if (
      typeof message == "number" &&
      message >= 0 &&
      message < wled.presets.length
    ) {
      wled.preset = message
      return {
        path: `/lightState`,
        data: getLightState(),
      };
    } else {
      return {
        path: `/error`,
        data: `Invalid preset number. Expected (number) in range 0 to ${wled.presets.length}, got (${typeof message}) ${message}`,
      };
    }
  },
};


function getLightState(){
  return {
    brightness: wled.bri,
    preset: wled.preset
  }
}

integration.connect() // Connect integration to the MQTT bus
