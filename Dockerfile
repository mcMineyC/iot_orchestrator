# syntax=docker/dockerfile:1

# Build stage
FROM golang:1.25.5-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY *.go .

# Build the binary for linux/amd64
RUN GOOS=linux GOARCH=amd64 go build -o main .

# Final image
FROM alpine:latest

WORKDIR /app

# Install node (modules must be installed before deploying config)
RUN apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main nodejs=24.11.1-r1 npm
# COPY ./package*.json /app/
# RUN npm ci

# Copy the built binary
COPY --from=builder /app/main /usr/local/bin/iot_orchestrator

# Expose MQTT port
EXPOSE 1883
WORKDIR /config

# Run the app (which handles its own mDNS advertisement)
CMD ["/usr/local/bin/iot_orchestrator"]
