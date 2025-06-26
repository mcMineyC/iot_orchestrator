import mqtt from "mqtt";
import fs from "fs";

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

async function getData(path) {
  // All under the /$clientID/getdata topic
  console.log("getData called with path:", "/" + path);
  switch ("/" + path) {
    case "/name":
      return config.config.name;
    case "/names":
      return ["Bob", "Frank", "Alice", "Charlie", "David", "Eve"];
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
  "/greet": (topic, message) => {
    console.log("Hello!");
    return {
      path: `/greeting`,
      data: `Hello, ${message.name}!`,
    };
  },
};
