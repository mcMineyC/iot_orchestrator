import { createRequire } from "module";
const require = createRequire(import.meta.url);

import Integration from "../apis/integration-base.js"
var integration = new Integration("automations");

integration.fetchers = {
}

var on = true;
var presets = [];
var presetId = -1;

integration.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  // so that any response message can be sent
  //
  // Can also be async
  "/all-toggle": (topic, message) => {
    on = !on;
    var ostr = on ? "on" : "off";
    integration.send("/bed-bulb/power/"+ostr, "");
    integration.send("/broom-closet-ending/power/"+ostr, "");
  },
  "/desk-toggle": (topic, message) => {
    integration.send("/deks-light/power/toggle", "");
    integration.send("/deks-rgb/power/toggle", "")
  },
  "/wled-cycle-preset": (topic, message) => {
    if(presetId == -1 || presetId == presets.length-1)
      presetId = 1
    else
      presetId++
    integration.send("/broom-closet-ending/light/preset", presets[presetId].id.toString())
  }
};

integration.listen("/arduino-hmi-panel/button1/longPressed", integration.commandHandlers["/wled-cycle-preset"]);
integration.listen("/arduino-hmi-panel/button1/pressed", integration.commandHandlers["/all-toggle"]);

integration.connect()
integration.fetchDataSync("broom-closet-ending", "lightState").then((ls) => presetId = ls.preset.id)
integration.fetchDataSync("broom-closet-ending", "presets").then((p) => {presets = p;presets.sort((a, b) => a-b);})
