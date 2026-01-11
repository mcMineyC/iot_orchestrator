import mdnsLib from "multicast-dns";

const queryService = (qName) => new Promise((resolve, reject) => {
  const mdns = mdnsLib();
  mdns.on('response', (response) => {
    var answers = response.answers.filter((r) => r.name == qName && r.type == "TXT" && r.data != undefined && r.data.length != 0)
    if(answers.length == 0){
      reject("No responses..?")
      return
    }
    var a = answers[0]
    var data = {};
    a.data.forEach((d) => {
      d = d.toString()
      data[d.split("=")[0]] = d.split("=")[1]
    })
    resolve({
      name: a.name,
      ip: data.ip,
      port: data.port,
      description: data.description
    })
  })
  mdns.query([{name:qName, type:'TXT'}])
})
console.log("\n\n\n\n\n",await queryService('_iot-orchestrator._tcp.local'))
console.log("resolved")
