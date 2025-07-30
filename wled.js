import WebSocket from "ws";
import Integration from "./integration-base.js";
var wled = new Integration("wled");
wled.connect()
const ws = new WebSocket(`ws://${wled.config.config.ip}/ws`)

// Gets name of current file without extension

ws.on("error", (e) => console.error("Websocket error:", e));

ws.on("open", function open() {
  console.log("WebSocket connection established!");
});


var presets = await fetchPresets(); // Fetch presets on startup

var state = {
  on: false,
  bri: 0,
  ps: -1, // preset index, -1 means no preset
};

ws.on("message", function message(data) {
  try {
    var msg = JSON.parse(data);
    // console.log(msg);
    if (typeof msg.success !== "undefined" && msg.success)
      console.log("Command completed successfully");
    else if (typeof msg.success !== "undefined" && !msg.success)
      console.log("Command failed");

    if (typeof msg.state !== "undefined") {
      state = msg.state;
      wled.publishData("/powerState", state.on ? "on" : "off")
      wled.publishData(
        `/lightState`,
        {
          brightness: state.bri,
          preset: state.ps,
          presetName:
            state.ps > 0 && state.ps < presets.length
              ? presets[state.ps].name
              : "",
        }
      );
    }
  } catch (e) {
    console.error("Failed to parse state:", e);
  }
  console.log(
    "Current state is %s, preset %s",
    state.on ? "ON" : "OFF",
    state.ps,
  );
});

//
//
//
//
//
//
//
//
//
//////////////////////////
///  data fetch logic  ///
/////////////////////////
wled.routes.getdata = {
  "/powerState": () => state.on ? "on" : "off",
  "/lightState": async () => {
    var tempState = {
      brightness: state.bri,
      preset: state.ps,
      presetName: "",
    };
    if(presets == undefined) {
      console.error("Presets not loaded yet, fetching...");
      presets = await fetchPresets();
    }
    console.log("We have %d presets", presets.length);
    if (tempState.preset > 0 && tempState.preset < presets.length) {
      tempState.presetName = presets[tempState.preset].name;
    }else{
      console.warn("Preset index out of bounds, using empty name");
    }
    return tempState;
  },
  "/presets": async () => await fetchPresets(),
}
// async function getData(path) {
//   // All under the /$clientID/getdata topic
//   console.log("getData called with path:", "/" + path);
//   switch ("/" + path) {
//     case "/powerState":
//       return state.on ? "on" : "off";
//     case "/lightState":
//     case "/presets":
//       return await fetchPresets();
//     default:
//       return null; // Return null if nothing needs to be returned
//   }
// }

//////////////////////////
/// command definition ///
/////////////////////////

wled.routes.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  "/power/on": (topic, message) => {
    console.log("Powering on!");
    ws.send(JSON.stringify({ on: true }));
    return {
      path: `/powerState`,
      data: "on",
    };
  },
  "/power/off": (topic, message) => {
    console.log("Powering off!");
    ws.send(JSON.stringify({ on: false }));
    return {
      path: `/powerState`,
      data: "off",
    };
  },
  "/power/toggle": (topic, message) => {
    console.log("Toggling power!");
    ws.send(JSON.stringify({ on: !state.on }));
    return {
      path: `/powerState`,
      data: state.on ? "off" : "on",
    };
  },
  "/light/brightness": (topic, message) => {
    console.log("Setting brightness!");
    if (typeof message == "number" && message >= 0 && message <= 255) {
      if (wled.config.config.maxBrightness) {
        message = Math.round((message / 255) * wled.config.config.maxBrightness);
      }
      ws.send(JSON.stringify({ bri: message }));
      return {
        path: `/lightState`,
        data: JSON.stringify({
          brightness: message,
          preset: state.ps,
          presetName: presets[state.ps].name,
        }),
      };
    } else {
      return {
        path: `/error`,
        data: "Invalid brightness value",
      };
    }
  },
  "/light/preset": (topic, message) => {
    console.log("Setting preset!");
    if (
      typeof message == "number" &&
      message >= 0 &&
      message < presets.length
    ) {
      ws.send(JSON.stringify({ ps: message }));
      return {
        path: `/lightState`,
        data: JSON.stringify({
          brightness: state.bri,
          preset: message,
          presetName: presets[message].name,
        }),
      };
    } else {
      return {
        path: `/error`,
        data: "Invalid preset number",
      };
    }
  },
  "/light/preset": (topic, message) => {
    console.log("Setting preset!");
    if (
      typeof message == "number" &&
      message >= 0 &&
      message < presets.length
    ) {
      ws.send(JSON.stringify({ ps: message }));
      return {
        path: `/lightState`,
        data: JSON.stringify({
          brightness: state.bri,
          preset: message,
          presetName: presets[message].name,
        }),
      };
    } else {
      return {
        path: `/error`,
        data: "Invalid preset number",
      };
    }
  },
};

async function fetchPresets() {
  try {
    console.log("Fetching presets from instance");
    const response = await fetch(`http://${wled.config.config.ip}/presets.json`);
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
    console.log("Fetched presets:", presetList.length);
    return presetList;
  } catch (error) {
    console.error("Failed to fetch presets:", error);
    process.exit(44);
  }
}
