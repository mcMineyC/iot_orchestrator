package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
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
	Path string `json:"path"`
	Type string `json:"type"`
}

type IntegrationStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
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
	mqtt.DEBUG = log.New(os.Stdout, "", 0)
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
		definition := config.KnownIntegrations[integration.Id]
		if definition == nil {
			log.Printf("When processing enabled integration %s:", integration.Id)
			log.Fatalf("\tIntegration %s is not available", integration.IntegrationName)
		}
		go monitorIntegration(definition, integration, client)
	}
}

func monitorIntegration(definition *IntegrationDefinition, entry *IntegrationEntry, client *mqtt.Client) {
	log.Printf("Monitoring %s, defined by %s", entry.Name, definition.Name)
	jsonData, _ := json.Marshal(definition)
	configArg := fmt.Sprintf("--config=\"%s\")", string(jsonData))
	cmd := exec.Command(definition.Command, configArg)
	err := cmd.Start()
	if err != nil {
		log.Printf("Failed to start integration %s: %v", entry.Name, err)
		publishStatus(client, entry.Name, "error")
	}
	cmd.Process.Wait()
	publishStatus(client, entry.Name, "stopped")
}

func publishStatus(client *mqtt.Client, name string, status string) {
	jsonStatus := IntegrationStatus{
		Name:   name,
		Status: status,
	}
	jsonData, _ := json.Marshal(jsonStatus)
	(*client).Publish("status", 0, false, jsonData)
}

func mqttServer() {
	// Create signals channel to run server until interrupted

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
