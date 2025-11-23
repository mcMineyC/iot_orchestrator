#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <MQTT.h>
#include <fmt.h>


char deviceName[] = "arduino-test"; // Unique name for integration
char orchestratorIp[15];

const char ssid[] = "YouSSID";
const char pass[] = "YourPassword!";

struct CLIENT_OPERATION {
  char type;       // [s|p|u] (subscribe|publish|unsubscribe),
  String topic;    // for everything
  String message;  // for publish
};


class OperationQueue {
private:
  int opPos = 0;
  CLIENT_OPERATION queue[10] = {};
public:
  void addOp(char type, String topic, String message) {
    queue[opPos] = CLIENT_OPERATION{ type, topic, message };
    opPos++;
  };

  void process(MQTTClient &client) {
    if (opPos == 0) return;
    switch (queue[opPos - 1].type) {
      case 's':
        client.subscribe(queue[opPos - 1].topic);
        break;
      case 'u':
        client.unsubscribe(queue[opPos - 1].topic);
        break;
      case 'p':
        client.publish(queue[opPos - 1].topic, queue[opPos - 1].message);
        break;
    };
    opPos--;
  }
};

OperationQueue opQueue;

WiFiClient net;
MQTTClient client;

void connect() {

  Serial.print("\nconnecting to mqtt.");
  while (!client.connect(deviceName)) {
    Serial.print(".");
    delay(1000);
  }

  Serial.println("\nconnected!");

  // Put any additional setup here, before the online notification

  client.subscribe(fmt::format("/{}/#", deviceName).c_str());
  sendMessage(fmt::format("/orchestrator/integration/{}/online", deviceName), "true");
  // client.unsubscribe("/hello");
};

void sendMessage(std::string topic, std::string payload) {
  opQueue.addOp('p', topic.c_str(), payload.c_str());
}

void messageReceived(String &topic, String &payload) {
  Serial.println("incoming: " + topic + " - " + payload);
  topic = topic.substring(strlen(deviceName) + 2);
  Serial.println("Path is " + topic);

  // Note: Do not use the client in the callback to publish, subscribe or
  // unsubscribe as it may cause deadlocks when other things arrive while
  // sending and receiving acknowledgments. Instead, change a global variable,
  // or push to a queue and handle it in the loop after calling `client.loop()`.
}

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  WiFi.begin(ssid, pass);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  Serial.print("\nchecking wifi.");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    digitalWrite(LED_BUILTIN, LOW);
    delay(1000);
    digitalWrite(LED_BUILTIN, HIGH);
    delay(1000);
  }

  Serial.println("setting up mDNS");
  if (!MDNS.begin(deviceName)) { Serial.println("Error setting up MDNS responder!"); }

  int n = MDNS.queryService("iot-orchestrator", "tcp", 5000);  // Send out query for esp tcp services
  Serial.println("mDNS query done");
  if (n == 0) {
    Serial.println("no services found");
    while (true) {
      digitalWrite(LED_BUILTIN, LOW);
      delay(250);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(250);
    }
  } else {
    Serial.print(n);
    Serial.println(" service(s) found");
    for (int i = 0; i < n; ++i) {
      // Print details for each service found
      Serial.print(i + 1);
      Serial.print(": ");
      Serial.print(MDNS.hostname(i));
      Serial.print(" (");
      Serial.print(MDNS.IP(i));
      sprintf(orchestratorIp, MDNS.IP(i).toString().c_str());
      Serial.print(":");
      Serial.print(MDNS.port(i));
      Serial.println(")");
    }
  }
  Serial.println(fmt::format("Using {} as orchestrator", orchestratorIp).c_str());


  // Note: Local domain names (e.g. "Computer.local" on OSX) are not supported
  // by Arduino. You need to set the IP address directly.
  client.begin(orchestratorIp, net);  // Todo: update to dynamically resolve address or via mDNS
  client.onMessage(messageReceived);

  connect();
  for(int x = 0; x < 3; x++){
    digitalWrite(LED_BUILTIN, LOW);
    delay(500);
    digitalWrite(LED_BUILTIN, HIGH);
    delay(500);
  }
}

void loop() {
  MDNS.update();
  client.loop();
  delay(10);  // <- fixes some issues with WiFi stability
  if (client.connected()) {
    opQueue.process(client);
  } else {
    connect();
  }
  // Put other non-blocking logic here
}
