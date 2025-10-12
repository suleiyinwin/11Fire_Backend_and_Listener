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
    // Enhanced configuration for Safari/Mobile compatibility
    knownAuthorities: ['login.microsoftonline.com'],
  },
  cache: {
    // Disable cache for server-side to avoid issues
    cacheLocation: 'none',
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
    // Network timeout for mobile connections
    networkTimeout: 30000,
    // Retry configuration for mobile networks
    retryConfig: {
      maxRetries: 3,
      retryDelay: 1000,
    }
  },
};

export const msalClient = new ConfidentialClientApplication(msalConfig);
