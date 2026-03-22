package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/mcMineyC/spotcontrol/quick"
)

// Config is the JSON structure passed by the orchestrator as argv[1]
type Config struct {
	IntegrationName string                 `json:"integrationName"`
	ID              string                 `json:"id"`
	Config          map[string]interface{} `json:"config"`
}

// MetadataPayload mirrors the shape the orchestrator expects for /metadata
type MetadataPayload struct {
	Title     string      `json:"title"`
	Album     string      `json:"album"`
	Artist    string      `json:"artist"`
	ImageUrl  string      `json:"imageUrl"`
	Explicit  bool        `json:"explicit"`
	CanvasUrl string      `json:"canvasUrl"`
	Length    interface{} `json:"length"`
}

// PlaybackStatePayload mirrors the shape the orchestrator expects for /playbackState
type PlaybackStatePayload struct {
	Playing string `json:"playing"`
	Shuffle bool   `json:"shuffle"`
	Repeat  bool   `json:"repeat"`
}

func mustParseConfigArg() Config {
	if len(os.Args) < 2 {
		log.Fatalf("expected config JSON as first argument (the orchestrator provides this)")
	}
	var cfg Config
	if err := json.Unmarshal([]byte(os.Args[1]), &cfg); err != nil {
		log.Fatalf("failed to parse config arg: %v", err)
	}
	if cfg.ID == "" {
		log.Fatalf("config must include id")
	}
	return cfg
}

func mqttClient(clientID string) mqtt.Client {
	opts := mqtt.NewClientOptions()
	opts.AddBroker("tcp://192.168.30.47:1883")
	opts.SetClientID(clientID)
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(1 * time.Second)
	cli := mqtt.NewClient(opts)
	token := cli.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		log.Fatalf("timeout connecting to mqtt broker")
	}
	if err := token.Error(); err != nil {
		log.Fatalf("mqtt connect error: %v", err)
	}
	return cli
}

func publishRaw(client mqtt.Client, topic string, payload []byte) {
	tok := client.Publish(topic, 0, false, payload)
	_ = tok.WaitTimeout(5 * time.Second)
}

func publishJSON(client mqtt.Client, topic string, v interface{}) {
	b, err := json.Marshal(v)
	if err != nil {
		// fallback to plain string representation
		publishRaw(client, topic, []byte(fmt.Sprintf("%v", v)))
		return
	}
	publishRaw(client, topic, b)
}

func publishString(client mqtt.Client, topic, s string) {
	publishRaw(client, topic, []byte(s))
}

// SchemaEntry represents a single path entry for the integration schema
type SchemaEntry struct {
	Path      string `json:"path"`
	Type      string `json:"type"`
	Fetchable bool   `json:"fetchable,omitempty"`
}

// writeSchema writes the integration's schema file to ../../schemas relative
// to the spotcontrol integration directory. This uses a simple relative
// path (../../schemas) as requested and is safe to run on startup.
func writeSchema(cfg Config) {
	entries := []SchemaEntry{
		{Path: "/position", Type: "data", Fetchable: true},
		{Path: "/metadata", Type: "data", Fetchable: true},
		{Path: "/playbackState", Type: "data", Fetchable: true},
		{Path: "/queue", Type: "data", Fetchable: true},
		{Path: "/devices", Type: "data", Fetchable: true},
		{Path: "/play", Type: "command"},
		{Path: "/pause", Type: "command"},
		{Path: "/next", Type: "command"},
		{Path: "/previous", Type: "command"},
		{Path: "/shuffle", Type: "command"},
		{Path: "/repeat", Type: "command"},
		{Path: "/seek", Type: "command"},
		{Path: "/transfer", Type: "command"},
		{Path: "/volume", Type: "command"},
	}

	// Write to ../../schemas relative to the current working directory of the binary.
	// The integration runs from iot_orchestrator/config/integrations/spotcontrol,
	// so ../../schemas will place the file in iot_orchestrator/config/schemas.
	schemaDir := filepath.Join("..", "..", "schemas")
	if err := os.MkdirAll(schemaDir, 0o755); err != nil {
		log.Printf("failed to create schemas dir %s: %v", schemaDir, err)
		return
	}
	schemaPath := filepath.Join(schemaDir, cfg.IntegrationName+".json")
	b, _ := json.MarshalIndent(entries, "", "  ")
	if err := os.WriteFile(schemaPath, b, 0o644); err != nil {
		log.Printf("failed to write schema file %s: %v", schemaPath, err)
		return
	}
	log.Printf("wrote schema to %s", schemaPath)
}

func main() {
	cfg := mustParseConfigArg()

	// Write the schema file on startup to ../../schemas/<integrationName>.json
	// This makes the integration self-documenting (matching integration-base.js behavior).
	writeSchema(cfg)

	client := mqttClient(cfg.ID)

	// Announce online (Integration base expects this topic)
	onlineTopic := fmt.Sprintf("/orchestrator/integration/%s/online", cfg.ID)
	publishString(client, onlineTopic, "true")
	defer publishString(client, onlineTopic, "false")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start spotcontrol quick connect (interactive may open browser flow if needed)
	qc := quick.QuickConfig{
		StatePath:   "integrations/spotcontrol/spotcontrol_state.json",
		Interactive: true,
	}
	res, err := quick.Connect(ctx, qc)
	if err != nil {
		log.Fatalf("failed to initialize spotcontrol: %v", err)
	}
	defer res.Close()

	ctrl := res.Controller

	// cached values to respond to getdata requests
	var positionMs int64 = -1
	var currentMeta MetadataPayload
	var playbackState PlaybackStatePayload
	var queueData interface{} = []interface{}{}

	// helper publish functions that match the integration schema expectations:
	// publish to /<id>/<path>
	publish := func(path string, v interface{}) {
		topic := fmt.Sprintf("/%s/%s", cfg.ID, strings.TrimPrefix(path, "/"))
		switch vb := v.(type) {
		case string:
			publishString(client, topic, vb)
		default:
			publishJSON(client, topic, v)
		}
	}

	// Subscribe to getdata topics: /<id>/getdata/<path>
	getPaths := []string{"/position", "/metadata", "/playbackState", "/queue", "/devices"}
	for _, p := range getPaths {
		sub := fmt.Sprintf("/%s/getdata%s", cfg.ID, p)
		localPath := p // capture
		if token := client.Subscribe(sub, 0, func(cli mqtt.Client, msg mqtt.Message) {
			switch localPath {
			case "/position":
				publish("/position", strconv.FormatInt(positionMs, 10))
			case "/metadata":
				publish("/metadata", currentMeta)
			case "/playbackState":
				publish("/playbackState", playbackState)
			case "/queue":
				publish("/queue", queueData)
			case "/devices":
				// return device list from controller.ListDevices()
				devs := ctrl.ListDevices()
				// convert to a minimal serializable representation
				out := make([]map[string]interface{}, 0, len(devs))
				for _, d := range devs {
					out = append(out, map[string]interface{}{
						"id":             d.Id,
						"name":           d.Name,
						"type":           d.Type,
						"isActive":       d.IsActive,
						"volume":         d.Volume,
						"supportsVolume": d.SupportsVolume,
					})
				}
				publish("/devices", out)
			}
		}); token.Wait() && token.Error() != nil {
			log.Printf("subscribe %s error: %v", sub, token.Error())
		}
	}

	// Command handlers: subscribe to /<id><path> (where path includes leading slash)
	commands := []string{"/play", "/pause", "/next", "/previous", "/shuffle", "/repeat", "/seek", "/transfer", "/volume"}
	for _, cpath := range commands {
		sub := fmt.Sprintf("/%s%s", cfg.ID, cpath)
		cp := cpath
		if token := client.Subscribe(sub, 0, func(cli mqtt.Client, msg mqtt.Message) {
			payload := string(msg.Payload())
			// try to unwrap JSON string if present
			var maybe interface{}
			if err := json.Unmarshal(msg.Payload(), &maybe); err == nil {
				if s, ok := maybe.(string); ok {
					payload = s
				}
			}

			log.Printf("received command %s -> %s", cp, payload)
			switch cp {
			case "/play":
				if err := ctrl.Play(ctx, ""); err != nil {
					log.Printf("play error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/pause":
				if err := ctrl.Pause(ctx, ""); err != nil {
					log.Printf("pause error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/next":
				if err := ctrl.Next(ctx, ""); err != nil {
					log.Printf("next error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/previous":
				if err := ctrl.Previous(ctx, ""); err != nil {
					log.Printf("previous error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/shuffle":
				b := false
				pl := strings.TrimSpace(strings.ToLower(payload))
				if pl == "true" || pl == "1" {
					b = true
				}
				if err := ctrl.SetShuffle(ctx, b, ""); err != nil {
					log.Printf("setShuffle error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/repeat":
				// Accept "off", "all"|"context", "track"
				s := strings.ToLower(strings.Trim(payload, " \"\n"))
				switch s {
				case "off":
					_ = ctrl.SetRepeat(ctx, "off", "")
				case "all", "context":
					_ = ctrl.SetRepeat(ctx, "context", "")
				case "track":
					_ = ctrl.SetRepeat(ctx, "track", "")
				default:
					_ = ctrl.SetRepeat(ctx, "off", "")
				}
			case "/seek":
				ms, err := strconv.ParseInt(strings.TrimSpace(payload), 10, 64)
				if err != nil {
					log.Printf("invalid seek payload: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), fmt.Sprintf("/seek: Message (%s) was presumably not a number", payload))
					return
				}
				if err := ctrl.Seek(ctx, ms, ""); err != nil {
					log.Printf("seek error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/transfer":
				// payload expected to be device id string
				devId := strings.TrimSpace(strings.Trim(payload, "\"\n"))
				if devId == "" {
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), "transfer: empty device id")
					return
				}
				if err := ctrl.TransferPlayback(ctx, devId, true); err != nil {
					log.Printf("transfer error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			case "/volume":
				// Support payloads: plain number (percent), or JSON {\"volume\":NN,\"deviceId\":\"...\"}
				var volPercent int
				var targetDevice string
				// Try number first
				if vp, err := strconv.Atoi(strings.TrimSpace(payload)); err == nil {
					volPercent = vp
				} else {
					// Try JSON
					var obj map[string]interface{}
					if err := json.Unmarshal([]byte(payload), &obj); err == nil {
						if v, ok := obj["volume"]; ok {
							switch vv := v.(type) {
							case float64:
								volPercent = int(vv)
							case int:
								volPercent = vv
							case string:
								if vi, err := strconv.Atoi(vv); err == nil {
									volPercent = vi
								}
							}
						}
						if d, ok := obj["deviceId"]; ok {
							if s, ok := d.(string); ok {
								targetDevice = s
							}
						}
					}
				}
				if volPercent < 0 || volPercent > 100 {
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), fmt.Sprintf("volume: invalid percent %d", volPercent))
					return
				}
				// Call SetVolume. If targetDevice is empty, pass empty string to target active device.
				if err := ctrl.SetVolume(ctx, volPercent, targetDevice); err != nil {
					log.Printf("setVolume error: %v", err)
					publishString(client, fmt.Sprintf("/%s/error", cfg.ID), err.Error())
				}
			}
		}); token.Wait() && token.Error() != nil {
			log.Printf("subscribe %s error: %v", sub, token.Error())
		}
	}

	// Subscribe to spotcontrol events
	playbackCh := ctrl.SubscribePlayback()
	metadataCh := ctrl.SubscribeMetadata()

	// Goroutine: publish playback events to MQTT and update cache
	go func() {
		for evt := range playbackCh {
			// evt.State is a struct (not a pointer) per spotcontrol types.
			st := evt.State

			// Update cached position and playback state based on the PlayerState struct.
			positionMs = st.PositionMs
			playing := "Paused"
			if st.IsPlaying {
				playing = "Playing"
			}
			repeat := st.RepeatContext || st.RepeatTrack
			playbackState = PlaybackStatePayload{
				Playing: playing,
				Shuffle: st.Shuffle,
				Repeat:  repeat,
			}

			// publish position and playbackState
			publish("/position", strconv.FormatInt(positionMs, 10))
			publish("/playbackState", playbackState)
		}
	}()

	// Goroutine: publish metadata events to MQTT and update cache
	go func() {
		for evt := range metadataCh {
			// evt.Metadata is a struct (not a pointer) per spotcontrol types.
			meta := evt.Metadata

			// Build currentMeta from TrackMetadata fields.
			currentMeta = MetadataPayload{
				Title:    meta.Title,
				Album:    meta.Album,
				Artist:   meta.Artist,
				ImageUrl: meta.ImageURL,
				Explicit: false,
				Length:   map[string]interface{}{"value": meta.DurationMs, "unit": "ms"},
			}
			publish("/metadata", currentMeta)
		}
	}()

	// Initial fetch and publish
	if st, err := ctrl.GetPlayerState(ctx); err == nil && st != nil {
		positionMs = st.PositionMs
		playing := "Paused"
		if st.IsPlaying {
			playing = "Playing"
		}
		playbackState = PlaybackStatePayload{
			Playing: playing,
			Shuffle: st.Shuffle,
			Repeat:  st.RepeatContext || st.RepeatTrack,
		}
		publish("/position", strconv.FormatInt(positionMs, 10))
		publish("/playbackState", playbackState)
	}

	if meta, err := ctrl.FetchCurrentTrackMetadata(ctx); err == nil && meta != nil {
		currentMeta = MetadataPayload{
			Title:    meta.Title,
			Album:    meta.Album,
			Artist:   meta.Artist,
			ImageUrl: meta.ImageURL,
			Explicit: false,
			Length:   map[string]interface{}{"value": meta.DurationMs, "unit": "ms"},
		}
		publish("/metadata", currentMeta)
	}

	// Publish queue (spotcontrol doesn't expose a queue here — keep empty placeholder)
	publish("/queue", queueData)

	// Wait for termination signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Println("shutting down")
	cancel()

	// close spotcontrol result (deferred) and disconnect MQTT
	time.Sleep(300 * time.Millisecond)
	client.Disconnect(250)
}
