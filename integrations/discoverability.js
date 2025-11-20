import { createRequire } from "module";
const require = createRequire(import.meta.url);
import MdnsService from "../apis/mdns-api.js"

import Integration from "../apis/integration-base.js"
var integration = new Integration("mdns-advertiser");

var service = {
  instance: "instance",
  name: integration.params.name,
  friendlyName: integration.params.friendlyName,
  port: integration.params.port
}

var mdns = new MdnsService(service);
mdns.advertise();

integration.fetchers = {
  "/name": () => {
    return service.friendlyName
  },
  "/serviceInfo": () => {
    return service
  }
}

integration.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  // so that any response message can be sent
  //
  // Can also be async
  "/changeName": (topic, message) => {
    service.friendlyName = message
    mdns = new MdnsService(service);
    mdns.advertise()
    return
  },
  "/addService": (topic, message) => {
    if(message.name == undefined || message.port == undefined){
      return {
        path: "/error",
        data: `Name or port not provided.  Expected (object), received ${typeof message} - ${JSON.stringify(message)}`
      }
    }
    mdns.addService(message)
    return
  },
  "/restart": (topic, message) => {
    mdns = new MdnsService(service);
    mdns.advertise()
    return
  },
};

integration.connect()
