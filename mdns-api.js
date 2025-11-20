import os from "os";
import mdnsLib from "multicast-dns";
const mdns = mdnsLib();
class MdnsService {
  //constructor(name, port) {
  //  this.name = name;
  //  this.port = port;
  //  this.ip = getLocalIP();
  //  this.services = [
  //    {
  //      name: this.name,
  //      port: this.port,
  //      ip: this.ip
  //    }
  //  ]
  //}
  constructor(service) {
    this.name = service.name;
    this.port = service.port;
    this.ip = getLocalIP();
    service.ip = this.ip;
    this.services = [service];
  }
  advertise() {
    if (!this.ip) {
      throw new Error("Unable to find a local IP address.");
    }
    var services = this.services;
    var serviceDefinitionToResponse = this.serviceDefinitionToResponse;
    console.log(
      `Advertising service '${this.name}._tcp.local' on ${this.ip}:${this.port}...`,
    );
    mdns.on("query", function (query) {
      if (
        query.questions.some(
          (q) =>
            services.filter((x) => q.name == `${x.name}._tcp.local`).length > 0,
        )
      ) {
        console.log("Received a query");
        // Respond to the query with service details
        let answers = [];
        services
          .filter((x) => query.questions[0].name == `${x.name}._tcp.local`)
          .forEach((service) => {
            let answer = serviceDefinitionToResponse(service);
            answers = answers.concat(answer);
          });
        mdns.respond({
          answers: answers,
        });
        console.log(JSON.stringify(answers, null, 2));
        console.log(
          `Responded with service details for ${this.name} at ${this.ip}:${this.port}`,
        );
      }
    });
  }
  addService(service) {
    if (!service.name || !service.port) {
      throw new Error("Service must have a name and port.");
    }
    if (!service.ip) {
      service.ip = this.ip;
    }
    this.services.push(service);
    console.log(
      `Added service ${service.name} at ${service.ip}:${service.port}`,
    );
  }
  serviceDefinitionToResponse(definition) {
    console.log(definition);
    return [
      {
        name: `${definition.name}._tcp.local`,
        type: "PTR",
        ttl: 120,
        data: `${definition.name}._tcp.local`,
      },
      {
        name: `${definition.name}._tcp.local`,
        type: "SRV",
        ttl: 120,
        data: {
          target: definition.ip, // Use the local IP address
          port: definition.port, // Port where the service is running
          weight: 0,
          priority: 10,
        },
      },
      {
        name: definition.ip,
        type: "A", // A record (IPv4 address)
        ttl: 120,
        data: definition.ip,
      },
      {
        name: `${definition.name}._tcp.local`,
        type: "TXT", // TXT record with metadata about the service
        ttl: 120,
        data: [
          `ip=${definition.ip}`,
          `port=${definition.port}`,
          `description=${definition.friendlyName || "No description"}`,
        ],
      },
    ];
  }

  stop() {
    mdns.destroy();
  }
}

function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  let localIP = null;

  // Loop through network interfaces to find the first non-internal IPv4 address
  for (const interfaceName in networkInterfaces) {
    for (const interfaceInfo of networkInterfaces[interfaceName]) {
      if (interfaceInfo.family === "IPv4" && !interfaceInfo.internal) {
        localIP = interfaceInfo.address;
        break;
      }
    }
    if (localIP) break; // Stop once we find the first valid IP
  }

  return localIP;
}

export default MdnsService;
