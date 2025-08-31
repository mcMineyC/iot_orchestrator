import {WledApi} from "./wled-api.js"
import Integration from "./integration-base.js";
console.log("Starting up...")
var integration = new Integration("wled-segment");
console.log("[[WLED]] Connecting to", "localhost:8040")
const wled = new WledApi("localhost:8040");
await wled.init() // Fetches presets and segments
console.log("Connected to bus and WLED instance")

var seg = wled.segments[integration.params.segment];

seg.on("power", (p) => {
  console.log("\t\t\tSegment power:",p)
})
seg.on("state", (s) => {
  console.log("\t\t\t\tSegment state updated", s.on)
})

//////////////////////////
///  data fetch logic  ///
/////////////////////////
integration.fetchers = {
  "/powerState": () => {console.log("Sending powerState"); return seg.power ? "on" : "off"},
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
  "/temperatureRange": () => {
    console.log("Sending temperature range")
    return {
      min: 2000,
      max: 40000
    }
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
    seg.power = true
    return {
      path: `/powerState`,
      data: "on",
    };
  },
  "/power/off": (topic, message) => {
    console.log("Powering off!");
    seg.power = false
    return {
      path: `/powerState`,
      data: "off",
    };
  },
  "/power/toggle": (topic, message) => {
    var pow = !seg.power
    seg.power = pow
    return {
      path: `/powerState`,
      data: seg.power ? "off" : "on",
    };
  },
  "/light/brightness": (topic, message) => {
    console.log("Setting brightness!");
    if (typeof message == "number" && message >= 0 && message <= 255) {
      if (integration.params.maxBrightness) {
        message = Math.round((message / 255) * integration.params.maxBrightness);
      }
      seg.bri = message
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
  "/light/color": (topic, message) => {
    console.log("Setting color!")
    if(!Array.isArray(message) || message.length !== 3)
      return {
        path: `/error`,
        data: `Invalid color.  Expected list with 3 items, got (${typeof message}) ${message}`
      }
  },
  "/light/temperature": (topic, message) => {
    console.log("Setting temperature!");
    if(typeof message !== "number" || message < 2000 || message > 40000)
      return {
        path: `/error`,
        data: `Invalid temperature. Expected number in range 2000 to 40,000, got (${typeof message}) ${message}`
      }
    seg.temperature = message
    return {
      path: `/lightState`,
      data: getLightState()
    }
  },
  "/light/effect": (topic, message) => {
    if(typeof message !== "number")
      return {
        path: `/error`,
        data: `Invalid effect ID.  Expected number in range (undetermined as of now), got (${typeof message}) ${message}`
      }
    seg.effect = message
    return {
      path: `/lightState`,
      data: getLightState()
    }
  },
  // "/light/preset": (topic, message) => {
  //   console.log("Setting preset!");
  //   if (
  //     typeof message == "number" &&
  //     message >= 0 &&
  //     message < presets.length
  //   ) {
  //     ws.send(JSON.stringify({ ps: message }));
  //     return {
  //       path: `/lightState`,
  //       data: JSON.stringify({
  //         brightness: state.bri,
  //         preset: message,
  //         presetName: presets[message].name,
  //       }),
  //     };
  //   } else {
  //     return {
  //       path: `/error`,
  //       data: "Invalid preset number",
  //     };
  //   }
  // },
};


function getLightState(){
  return {
    brightness: seg.bri,
    effect: seg.effect,
    temperature: seg.temperature,
    color: seg.color,
  }
}

integration.connect()
