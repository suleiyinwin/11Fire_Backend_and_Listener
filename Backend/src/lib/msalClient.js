import { ConfidentialClientApplication } from '@azure/msal-node';
import dotenv from 'dotenv';
dotenv.config(); 

export const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/organizations`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        if (!containsPii) console.log(`[MSAL] ${message}`);
      },
      piiLoggingEnabled: false,
      logLevel: 3, // 0=Error, 1=Warning, 2=Info, 3=Verbose
    },
  },
});
