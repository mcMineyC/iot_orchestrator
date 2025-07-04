import mqtt from "mqtt";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client } = require("tplink-smarthome-api");
const kasa = new Client();
import fs from "fs";

// Reads configuration
const config = JSON.parse(process.argv[2]);
var definition = JSON.parse(fs.readFileSync("config.json", "utf8"));
definition = definition.knownIntegrations[config.integrationName];
const clientId = config.id; // the id of this instance of the integration

var device;
try {
  // Device initialization times out mqtt
  device = await kasa.getDevice({ host: config.config.ip });
  console.log("Device initialized");
  console.log("Device is a", device.deviceType);
} catch (error) {
  var code = (
    error.toString().match(/Error: connect (?<code>\S+)/) || {
      groups: { code: error.toString().split("\n")[0].substring(6) },
    }
  ).groups.code;
  switch (code) {
    case "EHOSTUNREACH":
      console.error("Error: Device not online");
      process.exit(404);
      break;
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ECONNABORTED":
      console.error("Error: Device is not a kasa");
      process.exit(113);
      break;
    default:
      if (code.includes("TCP Timeout")) {
        console.log("Error: Device not online");
        process.exit(404);
      } else {
        console.error("Unknown error:", code);
        process.exit(1);
      }
      break;
  }
}
// Set up MQTT client
const client = mqtt.connect("mqtt://127.0.0.1:1883", {
  clientId: `kasa-${clientId}-${Date.now()}`, // unique id
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
client.publish(`/orchestrator/integration/${clientId}/online`, "true");
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

device.on("lightstate-update", (state) => {
  console.log("Light state updated:", state);
  client.publish(`/${clientId}/lightState`, JSON.stringify(state));
});
device.on("lightstate-on", (state) => {
  console.log("Power state updated:", state);
  client.publish(`/${clientId}/powerState`, "on");
});
device.on("lightstate-off", (state) => {
  console.log("Power state updated:", state);
  client.publish(`/${clientId}/powerState`, "off");
});

async function getData(path) {
  // All under the /$clientID/getdata topic
  console.log("getData called with path:", "/" + path);
  switch ("/" + path) {
    case "/lightState":
      if(device.deviceType != "bulb")
        break
      var data = await device.lighting.getLightState();
      return data;
    case "/powerState":
      return (await device.getPowerState()) ? "on" : "off";
    case "/temperatureRange":
      if(device.deviceType != "bulb")
        break
      return device.colorTemperatureRange;
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
  /*
  "/greet": (topic, message) => {
    console.log("Hello!");
    return {
      path: `/greeting`,
      data: `Hello, ${message.name}!`,
    };
    },*/
  "/power/on": async (topic, message) => {
    console.log("Powering on!");
    if (await device.setPowerState(true))
      return {
        path: `/powerState`,
        data: "on",
      };
    else
      return {
        path: `/error`,
        data: `Failed to power on`,
      };
  },
  "/power/off": async (topic, message) => {
    console.log("Powering off!");
    if (await device.setPowerState(false))
      return {
        path: `/powerState`,
        data: "off",
      };
    else
      return {
        path: `/error`,
        data: `Failed to power off`,
      };
  },
  "/power/toggle": async (topic, message) => {
    console.log("Toggling power!");
    await device.togglePowerState();
    return {
      path: `/powerState`,
      data: (await device.getPowerState()) ? "on" : "off",
    };
  },
  "/light/brightness": async (topic, message) => {
    console.log("Setting brightness!");
    if (
      typeof message == "number" &&
      (await device.lighting.setLightState({ brightness: message, on_off: 1 }))
    )
      return {
        path: `/lightState`,
        data: JSON.stringify(await device.lighting.getLightState()),
      };
    else
      return {
        path: `/error`,
        data: `Failed to set brightness: ${message}`,
      };
  },
  "/light/temperature": async (topic, message) => {
    console.log("Setting temperature!");
    if (
      typeof message == "number" &&
      message >= device.colorTemperatureRange.min &&
      message <= device.colorTemperatureRange.max &&
      (await device.lighting.setLightState({ color_temp: message, on_off: 1 }))
    )
      return {
        path: `/lightState`,
        data: JSON.stringify(await device.lighting.getLightState()),
      };
    else
      return {
        path: `/error`,
        data:
          message < device.colorTemperatureRange.min ||
          message > device.colorTemperatureRange.max
            ? `Invalid color temperature: ${message}`
            : `Failed to set temperature: ${message}`,
      };
  },
  "/light/color": async (topic, message) => {
    console.log("Setting color!");
    if (
      typeof message == "object" &&
      message.hasOwnProperty("hue") &&
      message.hasOwnProperty("saturation") &&
      message.hue >= 0 &&
      message.hue <= 360 &&
      message.saturation >= 0 &&
      message.saturation <= 100 &&
      (await device.lighting.setLightState({
        color_temp: 0,
        hue: message.hue,
        saturation: message.saturation,
        brightness: message.value || undefined,
        on_off: 1,
      }))
    )
      return {
        path: `/lightState`,
        data: JSON.stringify(await device.lighting.getLightState()),
      };
    else
      return {
        path: `/error`,
        data:
          typeof message !== "object"
            ? `Invalid color data (expected object): ${message}`
            : message.hue < 0 ||
                message.hue > 360 ||
                message.saturation < 0 ||
                message.saturation > 100
              ? `Invalid color: ${message}`
              : `Failed to set color: ${message}`,
      };
  },
};
