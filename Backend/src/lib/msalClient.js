import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';
import dotenv from 'dotenv';
dotenv.config();

const msalLogLevelEnv = (process.env.MSAL_LOG_LEVEL || 'WARNING').toUpperCase();
const msalLogLevelMap = {
  ERROR: LogLevel.Error,
  WARNING: LogLevel.Warning,
  INFO: LogLevel.Info,
  VERBOSE: LogLevel.Verbose,
};
const msalLogLevel = msalLogLevelMap[msalLogLevelEnv] ?? LogLevel.Warning;

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/organizations',
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(logLevel, message, containsPii) {
        // never log PII in production
        if (containsPii) return;
        switch (logLevel) {
          case LogLevel.Error:
            console.error('[MSAL] ', message);
            break;
          case LogLevel.Warning:
            console.warn('[MSAL] ', message);
            break;
          case LogLevel.Info:
            console.info('[MSAL] ', message);
            break;
          default:
            // Verbose or unknown
            console.debug('[MSAL] ', message);
        }
      },
      piiLoggingEnabled: false,
      logLevel: msalLogLevel,
    },
  },
};

export const msalClient = new ConfidentialClientApplication(msalConfig);
