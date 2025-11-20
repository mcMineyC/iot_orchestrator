import mqtt from "mqtt";
import fs from "fs";

import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname;
const fileName = path.basename(__filename, path.extname(__filename));


class Integration {
  constructor(integrationName){
    console.log("Setting up", integrationName)
    // Reads configuration
    this.config = JSON.parse(process.argv[2]);
    this.definition = JSON.parse(fs.readFileSync("config.json", "utf8"));
    this.definition = this.definition.knownIntegrations[this.config.integrationName];
    this.params = this.config.config;
    this.routes = {
      getdata: {},
      commandHandlers: {},
    };
    fs.writeFileSync(path.join(__dirname, "../configs", this.config.id+".json"), JSON.stringify(this.config,null,2))

    // Set up MQTT client
    this.clientId = this.config.id;
    
    this.client = mqtt.connect("mqtt://127.0.0.1:1883", {
      clientId: this.clientId, // unique id
      clean: true, // idk this helps it work
      reconnectPeriod: 1000,
      manualConnect: true,
    });

    // Connection handler
    this.client.on("error", (err) => {
      console.error("Connection error:", err);
    });
    this.client.on("connect", () => {
      console.log("Connected to broker");
      this.definition.schema.forEach((schema) => {
        // The schema defines all paths, follow the schema
        if (schema.type == "data" && schema.fetchable) {
          // Subscribe to all fetchable data paths
          this.client.subscribe(`/${this.config.id}/getdata${schema.path}`, async (err) => {
            if (!err && err != null) {
              console.log(
                "Failed to subscribe to",
                `/${this.config.id}/getdata${schema.path}`,
                ":",
                err,
              );
            }
          });
        } else if (schema.type == "command") {
          // Subscribe to all command paths
          this.client.subscribe(`/${this.config.id}${schema.path}`, async (err) => {
            if (!err && err != null) {
              console.log(
                "Failed to subscribe to",
                `/${this.config.id}${schema.path}`,
                ":",
                err,
              );
            }
          });
        }
      });

      // Client has finished setting up and ready to be bombarded with messages
      this.client.publish(`/orchestrator/integration/${this.clientId}/online`, "true");
      process.on("SIGTERM", () => {
        this.client.publish(`/orchestrator/integration/${this.clientId}/online`, "false")
        process.exit(2)
      })
    });
    this.client.on("message", async (topic, message) => {
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
      var path = topic;

      // Top-level route handler (ex out-of-scope subscription)
      var handler = this.routes[topic];
      console.log(topic)
      console.log(this.routes)
      if(handler){
        console.log("Handling via top-level route")
        // Handler exists
        // try {
        //   message = JSON.parse(message);
        // } catch (e) {} // Silently ignore invalid JSON
        try {
          // Call the handler and publish any result
          const result = await handler(topic, message);
          if (result && result.path && result.data)
            this.client.publish(`/${this.clientId}${result.path}`, result.data.type === "object" ? JSON.stringify(result.data) : result.data);
          return
        } catch (error) {
          console.error("Error handling message:", error);
        }
      } else {
        // We don't recognize this command, say so
        // console.log("Unknown listener for:", path);
        // this.client.publish(`/${this.clientId}/error`, `Unknown listener for "${path}"`);
      }


      // Data fetch
      // In scope topic (for our integration)
      path = topic.split("/").slice(2).join("/"); // chop off id since it's not relevant
      console.log("Received message on path:", path);
      if (path.split("/")[0] == "getdata") {
        // eg /$id/getdata/<data_path>
        console.log("Received request for data from ", path.split("/").slice(1));
        var data = await this.getData("/" + path.split("/").slice(1).join("/"));
        if (data == null) {
          // obviously don't handle getting data we don't know about
          console.log("Data path not found: ", path.split("/").slice(1).join("/"));
          return;
        }
        // MQTT doesn't like objects so stringify anything that comes by
        this.client.publish(`/${this.clientId}/${path.split("/")[1]}`, typeof data === "object" ? JSON.stringify(data) : data);
        return;
      }
      // Commands
      // Try getting the handler for the path
      handler = this.routes.commandHandlers["/" + path];
      if (handler) {
        // Handler exists
        // try {
        //   message = JSON.parse(message);
        // } catch (e) {} // Silently ignore invalid JSON
        try {
          // Call the handler and publish any result
          const result = await handler(topic, message);
          if (result && result.path && result.data)
            this.client.publish(`/${this.clientId}${result.path}`, typeof result.data === "object" ? JSON.stringify(result.data) : result.data);
        } catch (error) {
          console.error("Error handling message:", error);
        }
      } else {
        // We don't recognize this command, say so
        console.log("Unknown command:", path);
        this.client.publish(`/${this.clientId}/error`, `Unknown command "${topic}"`);
      }
    });
  }
  connect(){
    console.log("[[IntegrationBase]] Connect method called")
    // Save final schema for future reference
    var schemaPaths = [];
    Object.keys(this.routes.getdata).forEach((p) => {
      schemaPaths.push(({
        path: p,
        type: "data",
        fetchable: true,
      }));
    });
    Object.keys(this.routes.commandHandlers).forEach((p) => {
      schemaPaths.push(({
        path: p,
        type: "command",
        fetchable: false,
      }));
    });
    fs.writeFileSync(path.join(__dirname, "../schemas", this.config.integrationName+".json"), JSON.stringify(schemaPaths,null,2))

    this.client.connect()
    Object.keys(this.routes.getdata).forEach(async (p) => {
      var data = await this.getData(p)
      if(data !== null)
        this.publishData(p, data)
    })
  }
  get commandHandlers() { return this.routes.commandHandlers }
  set commandHandlers(handlers) { this.routes.commandHandlers = handlers }

  get fetchers() { return this.routes.getdata }
  set fetchers(fetches) { this.routes.getdata = fetches }


  async getData(path){
    console.log("getData called with path:", path)
    if(this.routes.getdata[path] !== undefined){
      return await this.routes.getdata[path]();
    }else{
      return null
    }
  }

  // Out-of-scope listening functions
  listen(fullPath, callback){
    this.client.subscribe(fullPath);
    this.routes[fullPath] = callback;
  }
  unlisten(fullPath){
    this.client.unsubscribe(fullPath);
    delete this.routes[fullPath];
  }

  // In-scope (relevant to integration) listening functions
  addCommand(path, callback){
    this.client.subscribe(`/${this.clientId}${path}`)
    this.routes.commandHandlers[path] = callback;
  }
  removeCommand(path, callback){
    this.client.unsubscribe(`/${this.clientId}${path}`)
    delete this.routes.commandHandlers[path];
  }


  publishData(path, payload){
    this.client.publish(`/${this.clientId}${path}`, typeof payload === "object" ? JSON.stringify(payload) : payload)
  }
}

export default Integration;
