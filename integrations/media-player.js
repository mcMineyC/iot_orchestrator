import MprisPlayer2 from "../apis/MprisPlayer2.js"; // Adjust the path as needed
import { Server } from "socket.io";
import http from 'http';
import MdnsService from "../apis/mdns-api.js";
import Integration from "../apis/integration-base.js"

var integration = new Integration("mpris-proxy");

// Primary service that's started
var playerName = integration.params.playerName; // Used both for MPRIS and service name
var friendlyName = playerName.charAt(0).toUpperCase() + playerName.slice(1)
var hostname = integration.params.hostname;
const service = {
  instance: "player",
  name: "dekstop-hud",
  friendlyName: `${friendlyName} on ${hostname}`,
  port: integration.params.port,
}

const mdns = new MdnsService(service);
mdns.advertise();

// Create an HTTP server (which will be used by Socket.io)
const server = http.createServer();
const io = new Server(server);

// Initialize MPRIS Player
const player = new MprisPlayer2('org.mpris.MediaPlayer2.'+playerName, '/org/mpris/MediaPlayer2');

// Function to start the player and handle server
const startPlayer = async () => {
  await player.init();
  await player.getMetadata();
  await player.getPlaybackStatus();
  await player.getPosition();
  console.log("Starting server");

  // Listen for WebSocket connections
  io.on("connection", (socket) => {
    console.log('Client connected');
    socket.emit('metadata', player.metadata);
    socket.emit('playbackState', player.playbackStatus);
    socket.emit('position', player.position);
    
    const metadataChanged = (metadata) => {
      console.log('Metadata updated:', metadata);
      socket.emit('metadata', metadata);
    };
    
    const positionChanged = (posMs) => {
      console.log('Position updated:', posMs);
      socket.emit('position', posMs);
    };
    
    const playbackStateChanged = (state) => {
      console.log('Playback state updated:', state);
      socket.emit('playbackState', state.toString());
    };
    
    // Register event listeners for player updates
    player.on('positionChanged', positionChanged);
    player.on('metadataChanged', metadataChanged);
    player.on('playbackStateChanged', playbackStateChanged);
    
    socket.on("play", async () => await player.play());
    socket.on("pause", async () => await player.pause());
    socket.on("next", async () => await player.next());
    socket.on("previous", async () => await player.previous());
    socket.on("seek", async (positionMs) => await player.seek(positionMs));
    socket.on("getMetadata", async () => await player.getMetadata());
    socket.on("getPosition", async () => await player.getPosition());
    socket.on("getPlaybackState", async () => await player.getPlaybackState());
    socket.on("friendlyName", () => socket.emit("friendlyName", service.friendlyName));

    socket.on("mdns:add", (service) => {
      try{
        mdns.addService(service);
      }catch(e){
        socket.emit("mdns:error", e);
      }finally{
        socket.emit("mdns:done", true);
      }
    })
    
    // Clean up event listeners when client disconnects
    socket.on('disconnect', () => {
      player.off('positionChanged', positionChanged);
      player.off('metadataChanged', metadataChanged);
      player.off('playbackStateChanged', playbackStateChanged);
    });
  });

  // Start the server to listen on port 3000
  server.listen(service.port, () => {
    console.log("Server is running on http://0.0.0.0:"+service.port);
    console.log("Connecting integration...")
    integration.connect()
    console.log("Integration connected!")
  });
};

integration.fetchers = {
  "/position": async () => await player.getPosition().toString(),
  "/metadata": async () => await player.getMetadata(),
  "/playbackState": async () => await player.getPlaybackStatus(),
}

integration.commandHandlers = {
  "/play": async (topic, message) => {
    await player.play()
  },
  "/pause": async (topic, message) => {
    await player.pause()
  },
  "/next": async (topic, message) => {
    await player.next()
  },
  "/previous": async (topic, message) => {
    await player.previous()
  },
  "/seek": async (topic, message) => {
    try{
      await player.seek(parseInt(message))
    }catch(e){
      return {
        path: "/error",
        data: `/seek: Message (${message}) was presumably not a number`
      }
    }
  },
}

// Possible bug: get(data) is called so we return the data in fetchers but also publish it here...
player.on('positionChanged', (position) => integration.publishData("/position", position.toString()))
player.on("metadataChanged", (metadata) => integration.publishData("/metadata", metadata))
player.on("playbackStateChanged", (pbs) => integration.publishData("/playbackState", pbs))


// Start the player and server
startPlayer();
