import mqtt from "mqtt";
import fs from "fs";
import WebSocket from "ws";
const ws = new WebSocket("ws://192.168.30.32/ws");

ws.on("error", console.error);

ws.on("open", function open() {
  console.log("WebSocket connection established!");
});

var state = {};

ws.on("message", function message(data) {
  try {
    var msg = JSON.parse(data);
    if (typeof msg.success !== "undefined" && msg.success)
      console.log("Command completed successfully");
    else if (typeof msg.success !== "undefined" && !msg.success)
      console.log("Command failed");
    else if (typeof msg.state !== "undefined") state = msg.state;

    if (state.state) state = state.state;
  } catch (e) {
    console.error("Failed to parse state:", e);
  }
  console.log(
    "Current state is %s, preset %s",
    state.on ? "ON" : "OFF",
    state.ps,
  );
});

// Gets name of current file without extension
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const fileName = path.basename(__filename, path.extname(__filename));

// Reads configuration
const config = JSON.parse(process.argv[2]);
var definition = JSON.parse(fs.readFileSync("config.json", "utf8"));
definition = definition.knownIntegrations[config.integrationName];
const clientId = config.id; // the id of this instance of the integration

// Set up MQTT client
const client = mqtt.connect("mqtt://127.0.0.1:1883", {
  clientId: `${fileName}-${clientId}-${Date.now()}`, // unique id
  clean: true, // idk this helps it work
  reconnectPeriod: 1000,
});

client.on("connect", () => {
  console.log("Connected to broker");
  definition.schema.forEach((schema) => {
    // The schema defines all paths, follow the schema
    if (schema.type == "data" && schema.fetchable) {
      // Subscribe to all fetchable data paths
      client.subscribe(`/${config.id}/getdata${schema.path}`, async (err) => {
        if (!err && err != null) {
          console.log(
            "Failed to subscribe to",
            `/${config.id}/getdata${schema.path}`,
            ":",
            err,
          );
        }
      });
    } else if (schema.type == "command") {
      // Subscribe to all command paths
      client.subscribe(`/${config.id}${schema.path}`, async (err) => {
        if (!err && err != null) {
          console.log(
            "Failed to subscribe to",
            `/${config.id}${schema.path}`,
            ":",
            err,
          );
        }
      });
    }
  });
});

client.on("message", async (topic, message) => {
  // message is Buffer
  message = message.toString();
  console.log(message);
  try {
    message = JSON.parse(message);
  } catch (e) {
    console.log(
      "Failed to parse message (not fatal)\n\tTopic:",
      topic,
      "\n\tMessage:",
      message,
    );
  } // give a notice of what and where it came from for debugging
  var path = topic.split("/").slice(2).join("/"); // chop off id since it's not relevant
  console.log("Received message on path:", path);
  if (path.split("/")[0] == "getdata") {
    // eg /$id/getdata/<data_path>
    console.log("Received request for data from ", path.split("/").slice(1));
    var data = await getData(path.split("/").slice(1).join("/"));
    if (data == null) {
      // obviously don't handle getting data we don't know about
      console.log("Data path not found: ", path.split("/").slice(1).join("/"));
      return;
    }
    // MQTT doesn't like objects so stringify anything that comes by
    client.publish(`/${clientId}/${path.split("/")[1]}`, JSON.stringify(data));
    return;
  }
  // Try getting the handler for the path
  const handler = commandHandlers["/" + path];
  if (handler) {
    // Handler exists
    try {
      message = JSON.parse(message);
    } catch (e) {} // Silently ignore invalid JSON
    try {
      // Call the handler and publish any result
      const result = await handler(topic, message);
      if (result && result.path && result.data)
        client.publish(`/${clientId}${result.path}`, result.data);
    } catch (error) {
      console.error("Error handling message:", error);
    }
  } else {
    // We don't recognize this command, say so
    console.log("Unknown command:", path);
    client.publish(`/${clientId}/error`, `Unknown command "/${path}"`);
  }
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
var presets = await fetchPresets();

async function getData(path) {
  // All under the /$clientID/getdata topic
  console.log("getData called with path:", "/" + path);
  switch ("/" + path) {
    case "/powerState":
      return state.on ? "on" : "off";
    case "/lightState":
      return {
        brightness: state.bri,
        preset: state.ps,
        presetName: presets[state.ps].name,
      };
    case "/presets":
      return await fetchPresets();
    default:
      return null; // Return null if nothing needs to be returned
  }
}

//////////////////////////
/// command definition ///
/////////////////////////

const commandHandlers = {
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
      if (config.config.maxBrightness) {
        message = Math.round((message / 255) * config.config.maxBrightness);
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
    const response = await fetch(`http://${config.config.ip}/presets.json`);
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
    return presetList;
  } catch (error) {
    console.error("Failed to fetch presets:", error);
    return null;
  }
}
