import mqtt from "mqtt";
import fs from "fs";
const client = mqtt.connect("mqtt://127.0.0.1:1883");
var names = ["Bob", "Frank", "Alice", "Charlie", "David", "Eve"];
const config = JSON.parse(process.argv[2]);
var definition = JSON.parse(fs.readFileSync("config.json", "utf8"));
definition = definition.knownIntegrations[config.integrationName];
const clientId = config.id;

client.on("connect", () => {
  console.log("Connected to broker");
  definition.schema.forEach((schema) => {
    if (schema.type == "data" && schema.fetchable) {
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
      "Failed to parse message\n\tTopic:",
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
      console.log("Data path not found: ", path.split("/").slice(1).join("/"));
      return;
    }
    client.publish(`/${clientId}/${path.split("/")[1]}`, JSON.stringify(data));
    return;
  }
  const handler = commandHandlers["/" + path];
  if (handler) {
    const result = await handler(topic, message);
    client.publish(`/${clientId}${result.path}`, result.data);
  } else {
    console.log("Unknown command:", path);
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
  console.log("getData called with path:", "/" + path);
  switch ("/" + path) {
    case "/name":
      return config.config.name;
    case "/names":
      return names;
    default:
      return null;
  }
}

//////////////////////////
/// command definition ///
/////////////////////////

const commandHandlers = {
  "/greet": (topic, message) => {
    console.log("Hello!");
    console.log("[hello]", typeof message, message);
    if (typeof message === "string" && message !== "")
      return { path: `/greeting`, data: `Hello, ${message}!` };
    else if (typeof message === "object" && message.greeting && message.name)
      return {
        path: `/greeting`,
        data: `${message.greeting}, ${message.name}!`,
      };
    else if (typeof message === "object" && message.name)
      return {
        path: `/greeting`,
        data: `Hello, ${message.name}!`,
      };
    else if (typeof message === "object" && message.greeting)
      return {
        path: `/greeting`,
        data: `${message.greeting}, ${config.config.name}!`,
      };
    else
      return {
        path: `/greeting`,
        data: `Hello, ${config.config.name}!`,
      };
  },
};
