import { createRequire } from "module";
const require = createRequire(import.meta.url);

import Integration from "../apis/integration-base.js"
var integration = new Integration("automations");

integration.fetchers = {
}

integration.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  // so that any response message can be sent
  //
  // Can also be async
  "/all-toggle": (topic, message) => {
    integration.publishData("/bed-bulb/power/toggle", "0");
    integration.publishData("/broom-closet-ending/power/toggle", "0");
  },
};

integration.listen("/arduino-hmi-panel/button1/pressed", integration.commandHandlers["/all-toggle"]);

integration.connect()