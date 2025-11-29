#!/bin/bash
# Clean up remnants
echo
echo
echo "Cleaning up remnants"
echo "--------------------"
rm iot_orchestrator.zip -rfv 2>/dev/null

# Build new artifact
echo
echo
echo "Building new artifact"
echo "---------------------"
go build
mkdir bundle
mv iot_orchestrator bundle/

echo
echo
echo "Copy supporting files"
echo "---------------------"
cp apis \
  integrations \
  config.json \
  bundle/ -rv
cp package.json \
  package-lock.json \
  restartIntegration.js \
  bundle/ -rv

echo
echo
echo "Create directories for supplemental generated files"
echo "---------------------------------------------------"
mkdir bundle/schemas -v
mkdir bundle/configs -v

echo
echo "Zip it up!"
echo "---------------------"
zip iot_orchestrator.zip bundle -rv

echo
echo
echo "Cleaning up"
echo "-----------"
rm bundle -rfv
