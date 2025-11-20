import { createRequire } from "module";
const require = createRequire(import.meta.url);

import Integration from "../apis/integration-base.js"
var integration = new Integration("automations");

integration.fetchers = {
}

var on = true;

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
};

integration.listen("/arduino-hmi-panel/button1/pressed", integration.commandHandlers["/all-toggle"]);

integration.connect()