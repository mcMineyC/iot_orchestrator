import mqtt from "mqtt"
import process from "process"
const integration = process.argv[2] || "";
var client = mqtt.connect("mqtt://127.0.0.1:1883", {
  clientId: "hehetempdude", // unique id
  clean: true, // idk this helps it work
  reconnectPeriod: 1000,
});

client.on("error", (err) => {
  console.error("Connection error:", err);
});
client.on("connect", () => {
  console.log("Connected to broker");
})
client.publish(`/orchestrator/integration/${integration}/stop`, "true");
setTimeout(() => { client.publish(`/orchestrator/integration/start`, integration); setTimeout(() => process.exit(0), 100); }, 100)

