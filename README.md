# IoT Orchestrator
This is a simple program to orchestrate the control of IoT devices.  It acts as a central hub for clients to connect to.  The protocol used for communication is MQTT.

# Features
- MQTT-based communication protocol
- Easy to understand, use, and configure
  - Unified configuration file
- Lightweight
  - It could probably run on a Behringer X2

# Installation
```
git clone https://github.com/mcMineyC/iot_orchestrator.git
cd iot_orchestrator
go run .
```

# Configuration
Check out example.js, as it provides a good starting point for an integration.  Config.json is also pre-populated with example usage.

# Inspiration
I was fed up with the complexity of creating a Home Assistant integration (Python is my least favorite language), so I created my own solution.  Plus, Home Assistant is very, very slow and YAML is not a good way to configure such things (imo).
