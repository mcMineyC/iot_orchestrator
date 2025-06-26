package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	mqttserver "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type MainConfig struct {
	Port                int                               `json:"port"`
	Host                string                            `json:"host"`
	EnabledIntegrations []*IntegrationEntry               `json:"enabledIntegrations"`
	KnownIntegrations   map[string]*IntegrationDefinition `json:"knownIntegrations"`
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
	Name   string `json:"name"`
	Status string `json:"status"`
	Error  string `json:"error"`
}

var integrationStatus = make(chan map[string]string)

var f mqtt.MessageHandler = func(client mqtt.Client, msg mqtt.Message) {
	fmt.Printf("TOPIC: %s\n", msg.Topic())
	fmt.Printf("MSG: %s\n", msg.Payload())
}

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
	content, err := os.ReadFile("config.json")
	if err != nil {
		log.Fatalf("Failed to read config.json: %v", err)
	}
	var config *MainConfig
	err = json.Unmarshal([]byte(content), &config)
	if err != nil {
		log.Fatalf("Failed to parse config.json: %v", err)
	}

	log.Printf("Configuration loaded successfully - Host: %s, Port: %d", config.Host, config.Port)
	log.Println("IoT Orchestrator initialization complete")
	log.Println("Starting MQTT server...")
	go mqttServer()
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

	log.Println("Connected to broker")

	if token := c.Subscribe("status", 0, nil); token.Wait() && token.Error() != nil {
		fmt.Println(token.Error())
		os.Exit(1)
	}

	go startIntegrations(config, &c)

	// Run server until interrupted
	<-done
}

func startIntegrations(config *MainConfig, client *mqtt.Client) {
	log.Printf("We have %d integrations available", len(config.KnownIntegrations))
	log.Printf("We need to start %d", len(config.EnabledIntegrations))
	for _, integration := range config.EnabledIntegrations {
		definition := config.KnownIntegrations[integration.IntegrationName]
		if definition == nil {
			log.Printf("When processing enabled integration %s:", integration.Id)
			log.Fatalf("\tIntegration %s is not available", integration.IntegrationName)
		}
		go monitorIntegration(definition, integration, client)
	}
}

func monitorIntegration(definition *IntegrationDefinition, entry *IntegrationEntry, client *mqtt.Client) {
	log.Printf("Monitoring %s, defined by %s", entry.Name, definition.Name)
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

	if err := cmd.Wait(); err != nil {
		log.Printf("Command finished with error: %v", err)
		publishStatus(client, entry.Id, "error", err.Error())
		return
	}
	publishStatus(client, entry.Id, "stopped", nil)
}

func publishStatus(client *mqtt.Client, name string, status string, error interface{}) {
	jsonStatus := IntegrationStatus{
		Name:   name,
		Status: status,
		Error: func() string {
			if error == nil {
				return ""
			}
			return fmt.Sprintf("%s", error)
		}(),
	}
	jsonData, _ := json.Marshal(jsonStatus)
	(*client).Publish("status", 0, false, jsonData)
}

func mqttServer() {
	// Create the new MQTT Server.
	server := mqttserver.New(nil)

	// Allow all connections.
	_ = server.AddHook(new(auth.AllowHook), nil)

	// Create a TCP listener on a standard port.
	tcp := listeners.NewTCP(listeners.Config{ID: "t1", Address: ":1883"})
	err := server.AddListener(tcp)
	if err != nil {
		log.Fatal(err)
	}

	go func() {
		err := server.Serve()
		if err != nil {
			log.Fatal(err)
		}
	}()

	// Cleanup
}
