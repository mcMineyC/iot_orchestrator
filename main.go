package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"path/filepath"

	mqttserver "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type MainState struct {
	Integrations      map[string]*IntegrationStatus `json:"integrations"`
	IntegrationStates map[string]map[string]any     `json:"integrationStates"`
}

type MainConfig struct {
	Port                             int                               `json:"port"`
	Host                             string                            `json:"host"`
	EnabledIntegrations              map[string]*IntegrationEntry      `json:"enabledIntegrations"`
	KnownIntegrations                map[string]*IntegrationDefinition `json:"knownIntegrations"`
	IntegrationStartupTimeoutSeconds int                               `json:"integrationStartupTimeoutSeconds"`
}

type IntegrationEntry struct {
	Name            string         `json:"name"`
	IntegrationName string         `json:"integrationName"`
	Id              string         `json:"id"`
	Config          map[string]any `json:"config"`
}

type IntegrationDefinition struct {
	Name        string               `json:"name"`
	Manage      bool                 `json:"manage"`
	Command     string               `json:"command"`
	CommandArgs []string             `json:"args"`
	Schema      []*IntegrationSchema `json:"schema"`
}

type IntegrationSchema struct {
	Path      string `json:"path"`
	Type      string `json:"type"`
	Fetchable bool   `json:"fetchable"`
}

type IntegrationStatus struct {
	Id							 string `json:"id"`
	Name             string `json:"name"`
	Status           string `json:"status"`
	ErrorCode        int    `json:"error"`
	ErrorDescription string `json:"errorDescription"`
}

var statusMap = make(map[string]*IntegrationStatus) // string is the id of integration
var mainState = MainState{
	Integrations:      statusMap,
	IntegrationStates: make(map[string]map[string]any),
}

var exitStatusRegex = regexp.MustCompile(`exit status (?<code>\d+)`)
var exitStatusDescriptor = map[int]string{
	44:  "device offline",
	113: "device misconfigured",
	2:   "manual intervention",
	1:   "unknown",
	0:   "",
}

var f mqtt.MessageHandler = func(client mqtt.Client, msg mqtt.Message) {
	fmt.Printf("TOPIC: %s\n", msg.Topic())
	fmt.Printf("MSG: %s\n", msg.Payload())
}

var config *MainConfig = nil;

var integrationSchemas map[string][]IntegrationSchema;

func main() {
	sigs := make(chan os.Signal, 1)
	done := make(chan bool, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		done <- true
	}()
	// Configure logger with file info only, no timestamp
	log.SetFlags(log.Lshortfile)
	// log.SetPrefix("[IoT Orchestrator] ")

	log.Println("Starting IoT Orchestrator...")

	log.Println("Reading configuration file...")
	config = loadConfig("config.json")
	log.Printf("Configuration loaded successfully - Host: %s, Port: %d", config.Host, config.Port)
	log.Println("IoT Orchestrator initialization complete")

	log.Println("Starting MQTT server...")
	disconnectChan := make(chan string)
	go mqttServer(disconnectChan)

	mqtt.DEBUG = log.New(io.Discard, "", 0)
	mqtt.ERROR = log.New(os.Stdout, "", 0)
	opts := mqtt.NewClientOptions().AddBroker("tcp://localhost:1883").SetClientID("orchestrator")
	opts.SetKeepAlive(2 * time.Second)
	opts.SetDefaultPublishHandler(f)
	opts.SetPingTimeout(1 * time.Second)

	c := mqtt.NewClient(opts)
	if token := c.Connect(); token.Wait() && token.Error() != nil {
		panic(token.Error())
	}
	// Start reading from the disconnect channel
	go func() {
		for clientID := range disconnectChan {
			if val, ok := statusMap[clientID]; ok && val.Status != "stopped" {
				log.Printf("Integration %s disconnected from bus", clientID)
				publishStatus(&c, config.EnabledIntegrations[clientID], "stopped", "disconnected from bus", 1)
			}
		}
	}()

	log.Println("Orchestrator connected to broker")

	// c.Subscribe("/orchestrator/status", 0, func(client mqtt.Client, msg mqtt.Message) {
	// 	log.Println("Received status message:", string(msg.Payload()))
	// })

	c.Subscribe("/orchestrator/getdata/status", 0, func(client mqtt.Client, msg mqtt.Message) {
		// Convert statusMap to JSON
		jsonData, err := json.Marshal(statusMap)
		if err != nil {
			log.Printf("Failed to marshal statusMap: %v", err)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get status"))
			return
		}
		// Publish the JSON response
		client.Publish("/orchestrator/status", 0, false, jsonData)
	})

	c.Subscribe("/orchestrator/getdata/state", 0, func(client mqtt.Client, msg mqtt.Message) {
		// var wg sync.WaitGroup
		// for _, entry := range config.EnabledIntegrations {
		// 	if mainState.IntegrationStates[entry.Id] == nil {
		// 		definition := findIntegrationByName(entry.IntegrationName, &mainConfig)
		// 		for _, pathEntry := range definition.Schema {
		// 			if pathEntry.Fetchable && pathEntry.Type == "data" {
		// 				var topic = fmt.Sprintf("/%s/getdata%s", entry.Id, pathEntry.Path)
		// 				client.Publish(topic, 0, false, "")
		// 				wg.Add(1)
		// 				go func() {
		// 					defer wg.Done()
		// 					// Wait for the response
		// 					responseTopic := fmt.Sprintf("/%s/data%s", entry.Id, pathEntry
		// 				}()
		// 			}
		// 		}
		// 	}
		// }
		jsonData, err := json.Marshal(mainState.IntegrationStates)
		if err != nil {
			log.Printf("Failed to marshal mainState: %v", err)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get state"))
			return
		}
		client.Publish("/orchestrator/state", 0, false, jsonData)
	})
	c.Subscribe("/orchestrator/getdata/fullState", 0, func(client mqtt.Client, msg mqtt.Message) {
		fmt.Printf("Request for fullState (sends /state and /status)")
		integrationData, err := json.Marshal(mainState.IntegrationStates)
		if err != nil {
			log.Printf("Failed to marshal mainState: %v", err)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get state"))
			return
		}
		statusData, errr := json.Marshal(statusMap)
		if errr != nil {
			log.Printf("Failed to marshal statusMap: %v", errr)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get status"))
			return
		}
		schemasData, errr := json.Marshal(integrationSchemas)
		if errr != nil {
			log.Printf("Failed to marshal statusMap: %v", errr)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get schemas"))
			return
		}
		// Publish the JSON response
		client.Publish("/orchestrator/status", 0, false, statusData)
		client.Publish("/orchestrator/state", 0, false, integrationData)
		client.Publish("/orchestrator/schemas", 0, false, schemasData)
	})

	c.Subscribe("/orchestrator/getdata/schemas", 0, func(client mqtt.Client, msg mqtt.Message) {
		schemasData, errr := json.Marshal(integrationSchemas)
		if errr != nil {
			log.Printf("Failed to marshal statusMap: %v", errr)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get schemas"))
			return
		}
		client.Publish("/orchestrator/schemas", 0, false, schemasData)
	})
	c.Subscribe("/orchestrator/getdata/enabledIntegrations", 0, func(client mqtt.Client, msg mqtt.Message) {
		// Convert statusMap to JSON
		jsonData, err := json.Marshal(config.EnabledIntegrations)
		if err != nil {
			log.Printf("Failed to marshal statusMap: %v", err)
			client.Publish("/orchestrator/error", 0, false, []byte("Failed to get status"))
			return
		}
		// Publish the JSON response
		client.Publish("/orchestrator/enabledIntegrations", 0, false, jsonData)
	})

	c.Subscribe("/orchestrator/integration/start", 0, func(client mqtt.Client, msg mqtt.Message) {
		integrationId := string(msg.Payload())
		if entry, ok := config.EnabledIntegrations[integrationId]; ok {
			log.Printf("Starting integration %s", integrationId)
			go startIntegration(config.KnownIntegrations[entry.IntegrationName], entry, &c)
		}
	})
	go startIntegrations(config, &c)

	// Run server until interrupted
	<-done
}

func findIntegrationByName(name string, config *MainConfig) *IntegrationDefinition {
	for _, entry := range config.KnownIntegrations {
		if entry.Name == name {
			return entry
		}
	}
	return nil
}

func startIntegrations(config *MainConfig, client *mqtt.Client) {
	log.Printf("We have %d integrations available", len(config.KnownIntegrations))
	log.Printf("We need to start %d", len(filterMap(config.EnabledIntegrations, func(entry *IntegrationEntry) bool {
		return config.KnownIntegrations[entry.IntegrationName].Manage
	})))
	for _, integration := range config.EnabledIntegrations {
		definition := config.KnownIntegrations[integration.IntegrationName]
		if definition == nil {
			log.Printf("When processing enabled integration %s:", integration.Id)
			log.Fatalf("\tIntegration %s is not available", integration.IntegrationName)
		}
		for _, schema := range definition.Schema {
			if schema.Fetchable && schema.Type == "data" {
				topic := fmt.Sprintf("/%s%s", integration.Id, schema.Path)
				log.Printf("Subscribing to %s for data", topic)
				token := (*client).Subscribe(topic, 0, func(client mqtt.Client, message mqtt.Message) {
					log.Printf("Received data on %s", topic)

					payload := string(message.Payload())

					if mainState.IntegrationStates[integration.Id] == nil {
						mainState.IntegrationStates[integration.Id] = make(map[string]any)
					}
					var data map[string]any;
					var saving any;
					if s := json.Unmarshal([]byte(payload), &data); s != nil {
						log.Printf("Was able to unmarshal (aka is JSON)")
						saving = data
					}else{
						log.Printf("Was NOT able to unmarshal (aka NOT JSON)")
						saving = payload
					}
					mainState.IntegrationStates[integration.Id][schema.Path] = saving
					log.Printf("Updated state for %s: %s = %s", integration.Id, schema.Path, payload)
					// Publish the updated state
				})
				if token.Wait() && token.Error() != nil {
					log.Printf("Failed to subscribe to %s: %v", topic, token.Error())
				}
			}
		}

		(*client).Subscribe(fmt.Sprintf("/orchestrator/integration/%s/online", integration.Id), 0, func(client mqtt.Client, message mqtt.Message) {
			log.Printf("Integration %s is online", integration.Id)
			// Fetch data for this integration
			publishStatus(&client, integration, "running", nil, 0)
			fetchIntegrationData(definition, integration, &client)
		})
		go startIntegration(definition, integration, client)
	}
}

func startIntegration(definition *IntegrationDefinition, entry *IntegrationEntry, client *mqtt.Client) {
	  publishStatus(client, entry, "starting", nil, 0)

		// Startup timeout logic
	timeout := config.IntegrationStartupTimeoutSeconds
	if timeout <= 0 {
		timeout = 15 // default if not set
	}
	go func(integration *IntegrationEntry) {
		time.Sleep(time.Duration(timeout) * time.Second)
		status := statusMap[integration.Id]
		if status != nil && status.Status == "starting" {
			publishStatus(client, integration, "stopped", "startup timeout", 44)
			log.Printf("Integration %s timed out during startup", integration.Id)
		}
	}(entry)

	if definition.Manage == true {
		log.Println(definition.Manage)
		go monitorIntegration(definition, entry, client)
	}
}

func fetchIntegrationData(definition *IntegrationDefinition, entry *IntegrationEntry, client *mqtt.Client) {
	log.Printf("Fetching data for %s", entry.Name)
	for _, schema := range definition.Schema {
		if schema.Fetchable && schema.Type == "data" {
			topic := fmt.Sprintf("/%s/getdata%s", entry.Id, schema.Path)
			log.Printf("Sending request for data on %s", topic)
			(*client).Publish(topic, 0, false, "")
		}
	}
}

func monitorIntegration(definition *IntegrationDefinition, entry *IntegrationEntry, client *mqtt.Client) {
	log.Printf("Monitoring %s, defined by %s",
		entry.Name,
		definition.Name)
	jsonData, _ := json.Marshal(entry) // the entry for the config is more useful than the definition
	configArg := string(jsonData)
	jsonData, _ = json.Marshal(definition)
	definitionArg := string(jsonData)
	commandParts := strings.Split(definition.Command, " ")
	cmd := exec.Command(commandParts[0])
	programArgs := commandParts[1:]
	cmd.Args = append(cmd.Args, programArgs...)
	cmd.Args = append(cmd.Args, configArg)
	cmd.Args = append(cmd.Args, definitionArg)

	// for _, arg := range cmd.Args {
	// 	fmt.Printf("[command args] %s\n", arg)
	// }

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal(err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Fatal(err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		log.Fatal(err)
	}

	// Read stdout in a goroutine
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			fmt.Printf("[%s][out]: %s\n", entry.Id, scanner.Text())
		}
	}()

	// Read stderr in a goroutine
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			fmt.Printf("[%s][err]: %s\n", entry.Id, scanner.Text())
		}
	}()
	(*client).Subscribe(fmt.Sprintf("/orchestrator/integration/%s/online", entry.Id), 0, func(client mqtt.Client, message mqtt.Message) {
		if string(message.Payload()) == "true" {
			publishStatus(&client, entry, "running", nil, 0)
		}
	})
	// Subscribe to stop command and keep track of the subscription
	stopTopic := fmt.Sprintf("/orchestrator/integration/%s/stop", entry.Id)
	token := (*client).Subscribe(stopTopic, 0, func(client mqtt.Client, message mqtt.Message) {
		if err := cmd.Process.Kill(); err != nil {
			log.Printf("Failed to kill process: %v", err)
		}
		publishStatus(&client, entry, "stopped", nil, 2)
	})

	// Wait for subscription to complete
	if token.Wait() && token.Error() != nil {
		log.Printf("Failed to subscribe to stop topic: %v", token.Error())
	}

	// Function to cleanup subscription
	defer func() {
		log.Printf("Unsubscribing integration %s from %s", entry.Id, stopTopic)
		if unsubToken := (*client).Unsubscribe(stopTopic); unsubToken.Wait() && unsubToken.Error() != nil {
			log.Printf("Failed to unsubscribe from %s: %v", stopTopic, unsubToken.Error())
		}
	}()

	if err := cmd.Wait(); err != nil {
		log.Printf("Command finished with error: %v", err)
		match := exitStatusRegex.FindStringSubmatch(err.Error())
		code := 1
		if len(match) > 0 {
			codei64, _ := strconv.ParseInt(match[1], 10, 8)
			code = int(codei64)
			log.Printf("Integration stopped because %s", exitStatusDescriptor[int(code)])
		} else if err.Error() == "signal: killed" {
			code = 2
		}
		publishStatus(client, entry, "stopped", err.Error(), code)
		return
	}
	publishStatus(client, entry, "stopped", nil, 1)
}

func publishStatus(client *mqtt.Client, entry *IntegrationEntry, status string, error interface{}, errorCode int) {
	jsonStatus := IntegrationStatus{
		Id: entry.Id,
		Name:      entry.Name,
		Status:    status,
		ErrorCode: errorCode,
		ErrorDescription: func() string {
			description, exists := exitStatusDescriptor[errorCode]
			if !exists {
				return exitStatusDescriptor[1]
			}
			return description
		}(),
	}
	statusMap[entry.Id] = &jsonStatus
	jsonData, _ := json.Marshal(jsonStatus)
	(*client).Publish(fmt.Sprintf("/orchestrator/status/%s", entry.Id), 0, false, jsonData)
}

func readIntegrationDefinitionSchemas() map[string][]IntegrationSchema {
	schemaMap := make(map[string][]IntegrationSchema)
	entries, err := os.ReadDir("schemas")
  if err != nil {
      fmt.Errorf("error reading directory %q: %w", "schemas", err)
  }

	for _, entry := range entries {
		var schemaList []IntegrationSchema;

		//Check to see it's a JSON file
		if(!entry.IsDir() && filepath.Ext(entry.Name()) == ".json"){

			// Read file
			content, err := os.ReadFile("schemas/"+entry.Name())
			if err != nil {
				log.Fatalf("Failed to read %s: %v", "schemas/"+entry.Name(), err)
			}

			// Deserialise
			err = json.Unmarshal([]byte(content), &schemaList)
    	if err != nil {
      	log.Printf("Error unmarshaling JSON for %s: %v", filepath.Base(entry.Name()), err)
    	}
			schemaMap[strings.Split(entry.Name(), ".")[0]] = schemaList
		}
	}

	return schemaMap
}

type MyHooks struct {
	mqttserver.HookBase
	DisconnectChan chan string
}

// OnDisconnect sends client ID to the channel
func (h *MyHooks) OnDisconnect(cl *mqttserver.Client, err error, expire bool) {
	log.Printf("Client disconnected: %s (expired: %v, err: %v)\n", cl.ID, expire, err)
	h.DisconnectChan <- cl.ID
}

func (h *MyHooks) Provides(b byte) bool {
	return bytes.Contains([]byte{
		mqttserver.OnDisconnect,
	}, []byte{b})
}

func (h *MyHooks) Init(any) error {
	log.Printf("\t\t\t hooks initialised")
	return nil
}

func mqttServer(disconnectChan chan string) {
	// Create the new MQTT Server.
	server := mqttserver.New(nil)

	myHooks := &MyHooks{
		DisconnectChan: disconnectChan,
	}

	// Allow all connections.
	_ = server.AddHook(new(auth.AllowHook), nil)

	// Add disconnect listener
	if err := server.AddHook(myHooks, nil); err != nil {
		log.Fatal(err)
	}

	// Create a TCP listener on a standard port.
	tcp := listeners.NewTCP(listeners.Config{ID: "t1", Address: ":1883"})
	err := server.AddListener(tcp)
	ws := listeners.NewWebsocket(listeners.Config{
		ID:      "ws1",
		Address: ":1882",
	})
	err = server.AddListener(ws)
	if err != nil {
		log.Fatal(err)
	}

	go func() {
		err := server.Serve()
		if err != nil {
			log.Fatal(err)
		}
	}()
}

func filter[T any](data []T, f func(T) bool) []T {

	fltd := make([]T, 0, len(data))

	for _, e := range data {
		if f(e) {
			fltd = append(fltd, e)
		}
	}

	return fltd
}

func filterMap[T any](data map[string]T, f func(T) bool) []T {
	fltd := make([]T, 0, len(data))
	for _, e := range data {
		if f(e) {
			fltd = append(fltd, e)
		}
	}
	return fltd
}

// loadConfig reads config.json, transforms enabledIntegrations array to map if needed, and returns MainConfig
func loadConfig(path string) *MainConfig {
	content, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("Failed to read %s: %v", path, err)
	}

	var rawConfig map[string]any
	err = json.Unmarshal(content, &rawConfig)
	if err != nil {
		log.Fatalf("Failed to parse %s: %v", path, err)
	}

	enabledRaw, ok := rawConfig["enabledIntegrations"]
	if !ok {
		log.Fatalf("enabledIntegrations missing from %s", path)
	}
	var enabledMap map[string]*IntegrationEntry
	switch v := enabledRaw.(type) {
	case []any:
		enabledMap = make(map[string]*IntegrationEntry)
		for _, item := range v {
			entryBytes, err := json.Marshal(item)
			if err != nil {
				log.Fatalf("Failed to marshal enabledIntegration entry: %v", err)
			}
			var entry IntegrationEntry
			if err := json.Unmarshal(entryBytes, &entry); err != nil {
				log.Fatalf("Failed to unmarshal enabledIntegration entry: %v", err)
			}
			if entry.Id == "" {
				log.Fatalf("enabledIntegration entry missing 'id' field: %+v", entry)
			}
			enabledMap[entry.Id] = &entry
		}
	case map[string]any:
		enabledMap = make(map[string]*IntegrationEntry)
		for id, item := range v {
			entryBytes, err := json.Marshal(item)
			if err != nil {
				log.Fatalf("Failed to marshal enabledIntegration entry: %v", err)
			}
			var entry IntegrationEntry
			if err := json.Unmarshal(entryBytes, &entry); err != nil {
				log.Fatalf("Failed to unmarshal enabledIntegration entry: %v", err)
			}
			entry.Id = id // Ensure id is set
			enabledMap[id] = &entry
		}
	default:
		log.Fatalf("enabledIntegrations must be an array or object in %s", path)
	}

	// Unmarshal the rest of the config, ignoring enabledIntegrations
	type MainConfigNoIntegrations struct {
		Port              int                               `json:"port"`
		Host              string                            `json:"host"`
		KnownIntegrations map[string]*IntegrationDefinition `json:"knownIntegrations"`
	}
	var configNoIntegrations MainConfigNoIntegrations
	err = json.Unmarshal(content, &configNoIntegrations)
	if err != nil {
		log.Fatalf("Failed to parse %s: %v", path, err)
	}

	config := &MainConfig{
		Port:                configNoIntegrations.Port,
		Host:                configNoIntegrations.Host,
		KnownIntegrations:   configNoIntegrations.KnownIntegrations,
		EnabledIntegrations: enabledMap,
	}

	integrationSchemas = readIntegrationDefinitionSchemas()
	log.Println("Loaded integration schemas")

	return config
}
