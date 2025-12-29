import { Server } from "socket.io";
import http from 'http';
import Integration from "../apis/integration-base.js"

var integration = new Integration("spotify-connector");
//Not backwards compatible with dekstop-hud anymore

// Create an HTTP server (which will be used by Socket.io)
const server = http.createServer();
const io = new Server(server);

// Function to start the player and handle server
var controlSock = false;
var state = {
  queue: {},
  metadata: { title: "No song playing", artist: "N/A", album: "N/A", imageUrl: "", length: -1 },
  position: -1,
  playbackState: { playing: "Paused", shuffle: false, repeat: false },
}
const startPlayer = async () => {
  console.log("Starting server");

  // Listen for WebSocket connections
  io.on("connection", (socket) => {
    console.log('Client connected');
    controlSock = socket;
    socket.on("queue", (queue) => integration.publishData("/queue", queue))
    socket.on("position", (position) => integration.publishData("/position", position.toString()))
    socket.on("metadata", (msg) => integration.publishData("/metadata", ({
      title: msg.title,
      album: msg.album_title,
      artist: msg.artist_name,
      imageUrl: "https://i.scdn.co/image/" + (msg.image_url || "").split(":")[2],
      explicit: msg.is_explicit == true,
      canvasUrl: msg["canvas.url"] || "",
      length: {value: parseInt(msg.duration), unit: "ms"}
    })))
    socket.on("playbackState", (pbs) => integration.publishData("/playbackState", pbs))

    socket.on("queue", (queue) => state.queue = queue)
    socket.on("position", (position) => state.position = position)
    socket.on("metadata", (msg) => state.metadata = ({
      title: msg.title,
      album: msg.album_title,
      artist: msg.artist_name,
      imageUrl: "https://i.scdn.co/image/" + (msg.image_url || "").split(":")[2],
      explicit: msg.is_explicit == true,
      canvasUrl: msg["canvas.url"] || "",
      length: parseInt(msg.duration) / 1000,
    }))
    socket.on("playbackState", (pbs) => state.playbackState = pbs)
    // socket.emit('metadata', player.metadata);
    // socket.emit('playbackState', player.playbackStatus);
    // socket.emit('position', player.position);
    //
    // const metadataChanged = (metadata) => {
    //   console.log('Metadata updated:', metadata);
    //   socket.emit('metadata', metadata);
    // };
    //
    // const positionChanged = (posMs) => {
    //   console.log('Position updated:', posMs);
    //   socket.emit('position', posMs);
    // };
    //
    // const playbackStateChanged = (state) => {
    //   console.log('Playback state updated:', state);
    //   socket.emit('playbackState', state.toString());
    // };
    //
    // // Register event listeners for player updates
    // player.on('positionChanged', positionChanged);
    // player.on('metadataChanged', metadataChanged);
    // player.on('playbackStateChanged', playbackStateChanged);
    //
    // socket.on("play", async () => await player.play());
    // socket.on("pause", async () => await player.pause());
    // socket.on("next", async () => await player.next());
    // socket.on("previous", async () => await player.previous());
    // socket.on("seek", async (positionMs) => await player.seek(positionMs));
    // socket.on("getMetadata", async () => await player.getMetadata());
    // socket.on("getPosition", async () => await player.getPosition());
    // socket.on("getPlaybackState", async () => await player.getPlaybackState());
    // socket.on("friendlyName", () => socket.emit("friendlyName", service.friendlyName));
    //
    // socket.on("mdns:add", (service) => {
    //   try{
    //     mdns.addService(service);
    //   }catch(e){
    //     socket.emit("mdns:error", e);
    //   }finally{
    //     socket.emit("mdns:done", true);
    //   }
    // })
    //
    // // Clean up event listeners when client disconnects
    // socket.on('disconnect', () => {
    //   player.off('positionChanged', positionChanged);
    //   player.off('metadataChanged', metadataChanged);
    //   player.off('playbackStateChanged', playbackStateChanged);
    // });
  });

  // Start the server to listen on port 3000
  server.listen(integration.params.port, () => {
    console.log("Server is running on http://0.0.0.0:" + integration.params.port);
    console.log("Connecting integration...")
    integration.connect()
    console.log("Integration connected!")
  });
};

integration.fetchers = {
  "/position": async () => state.position.toString(),
  "/metadata": async () => state.metadata,
  "/playbackState": async () => state.playbackState,
  "/queue": async () => state.queue,
}

integration.commandHandlers = {
  "/play": async (topic, message) => {
    controlSock.emit("play", "")
  },
  "/pause": async (topic, message) => {
    controlSock.emit("pause", "")
  },
  "/next": async (topic, message) => {
    controlSock.emit("next", "")
  },
  "/previous": async (topic, message) => {
    controlSock.emit("previous", "")
  },
  "/shuffle": async (topic, message) => {
    console.log("Setting shuffle to", message)
    controlSock.emit("shuffle", message)
  },
  "/repeat": async (topic, message) => {
    controlSock.emit("repeat", message) // off, all
  },
  "/seek": async (topic, message) => {
    try {
      controlSock.emit("seek", parseInt(message))
    } catch (e) {
      return {
        path: "/error",
        data: `/seek: Message (${message}) was presumably not a number`
      }
    }
  },
}

// Start the player and server
startPlayer();
