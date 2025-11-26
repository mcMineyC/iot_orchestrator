import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { exec } from 'node:child_process';

function shutdownComputer() {
    return new Promise((resolve, reject) => {
        const shutdownCommand = 'sudo shutdown now';
        
        exec(shutdownCommand, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Failed to execute shutdown command: ${error.message}`));
                return;
            }
            
            resolve();
        });
    });
}

import Integration from "../apis/integration-base.js"
var integration = new Integration("poweroff");

integration.fetchers = {
}

integration.commandHandlers = {
  // Each command handler should be defined here
  // It takes the topic and message as parameters
  // Every handler should return an object of the form
  // { path: string, data: any }
  // so that any response message can be sent
  //
  // Can also be async
  "/poweroff": (topic, message) => {
    console.log("Shutting down");
    shutdownComputer();
    return {
      path: `/greeting`,
      data: `Hello, ${message.name}!`,
    };
  },
};

integration.connect()
