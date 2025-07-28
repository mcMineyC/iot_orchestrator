import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client } = require("tplink-smarthome-api");
const kasa = new Client();

import Integration from "./integration-base.js"
var integration = new Integration("kasa");

var device;
try {
  // Device initialization times out mqtt
  device = await kasa.getDevice({ host: integration.config.config.ip });
  console.log("Device initialized");
  console.log("Device is a", device.deviceType);
} catch (error) {
  var code = (
    error.toString().match(/Error: connect (?<code>\S+)/) || {
      groups: { code: error.toString().split("\n")[0].substring(6) },
    }
  ).groups.code;
  switch (code) {
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      console.error("Error: Device not online");
      process.exit(44);
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
        process.exit(44);
      } else {
        console.error("Unknown error:", code);
        process.exit(1);
      }
      break;
  }
}
integration.connect();
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
  integration.publishData(`/lightState`, state);
});
device.on("lightstate-on", (state) => {
  console.log("Power state updated:", state);
  integration.publishData(`/powerState`, "on");
});
device.on("lightstate-off", (state) => {
  console.log("Power state updated:", state);
  integration.publishData(`/powerState`, "off");
});

integration.fetchers = {
  "/lightState": async () => {
    if(device.deviceType != "bulb")
      return 
    return await device.lighting.getLightState();
  },
  "/powerState": async () => (await device.getPowerState()) ? "on" : "off",
  "/temperatureRange": () => {
    if(device.deviceType !== "bulb")
      return null
    return device.colorTemperatureRange;
  }
}

//////////////////////////
/// command definition ///
/////////////////////////

integration.commandHandlers = {
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
        data: await device.lighting.getLightState(),
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
        data: await device.lighting.getLightState(),
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
        data: await device.lighting.getLightState(),
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
