import { EventEmitter } from "events";
/**
 * Backend Event System for 11Fire
 * Centralized event emission and handling for all backend activities
 */
class BackendEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

// Singleton instance
const backendEvents = new BackendEventEmitter();

/**
 * Event Types Constants
 */
export const EVENT_TYPES = {
  // Swarm/Group Events
  SWARM_CREATED: "swarm:created", //Z
  SWARM_JOINED: "swarm:joined", //Z
  SWARM_LEFT: "swarm:left", //Z

  // Provider Events
  PROVIDER_CONNECTED: "provider:connected",
  PROVIDER_DISCONNECTED: "provider:disconnected",
  PROVIDER_REGISTERED: "provider:registered",
  PROVIDER_CLAIMED: "provider:claimed",

  // File Events
  FILE_UPLOADED: "file:uploaded", //z
  FILE_DOWNLOADED: "file:downloaded", //z
  FILE_DELETED: "file:deleted", //z
  FILE_PIN_PROVIDER: "file:pinned", //z
  FILE_UNPINNED: "file:unpinned", //z
  FILE_ENCRYPTED: "file:encrypted", //z
  FILE_DECRYPTED: "file:decrypted", //z
  FILE_ENCRYPTION_FAILED: "file:encryption_failed", //z
  FILE_DECRYPTION_FAILED: "file:decryption_failed", //z

  // Replication Events
  REPLICATION_STARTED: "replication:started",
  REPLICATION_COMPLETED: "replication:completed",
  REPLICATION_FAILED: "replication:failed",

  // Authentication Events
  USER_ROLE_SET: "user:role_set",

  // WebSocket Events
  WS_CONNECTION: "ws:connection",
  WS_DISCONNECTION: "ws:disconnection",

  // System Events
  SYSTEM_STARTUP: "system:startup",
  // SYSTEM_SHUTDOWN: "system:shutdown",
  // SYSTEM_ERROR: "system:error",
};

/**
 * Event Emission Helper Functions
 */

// Swarm Events
export function emitSwarmCreated(swarmData) {
  backendEvents.emit(EVENT_TYPES.SWARM_CREATED, {
    swarmId: swarmData.swarmId,
    name: swarmData.name,
    creator: swarmData.creator,
    timestamp: Date.now(),
  });
}

export function emitSwarmJoined(userData, swarmData) {
  backendEvents.emit(EVENT_TYPES.SWARM_JOINED, {
    user: userData,
    swarm: swarmData,
    timestamp: Date.now(),
  });
}

export function emitSwarmLeft(userData, swarmData) {
  backendEvents.emit(EVENT_TYPES.SWARM_LEFT, {
    user: userData,
    swarm: swarmData,
    timestamp: Date.now(),
  });
}

// Provider Events
export function emitProviderConnected(providerData) {
  backendEvents.emit(EVENT_TYPES.PROVIDER_CONNECTED, {
    peerId: providerData.peerId,
    username: providerData.username,
    swarms: providerData.swarms || [],
    timestamp: Date.now(),
  });
}

export function emitProviderDisconnected(providerData) {
  backendEvents.emit(EVENT_TYPES.PROVIDER_DISCONNECTED, {
    peerId: providerData.peerId,
    username: providerData.username,
    reason: providerData.reason || "unknown",
    timestamp: Date.now(),
  });
}

export function emitProviderRegistered(userId, peerId) {
  backendEvents.emit(EVENT_TYPES.PROVIDER_REGISTERED, {
    userId,
    peerId,
    timestamp: Date.now(),
  });
}

export function emitProviderClaimed(userId, peerId, token) {
  backendEvents.emit(EVENT_TYPES.PROVIDER_CLAIMED, {
    userId,
    peerId,
    token: token ? "***" : null,
    timestamp: Date.now(),
  });
}

// File Events
export function emitFileUploaded(fileData, uploaderData, swarmData) {
  backendEvents.emit(EVENT_TYPES.FILE_UPLOADED, {
    file: fileData,
    uploader: uploaderData,
    swarm: swarmData,
    timestamp: Date.now(),
  });
}

export function emitFileDownloaded(fileData, downloaderData) {
  backendEvents.emit(EVENT_TYPES.FILE_DOWNLOADED, {
    file: fileData,
    downloader: downloaderData,
    timestamp: Date.now(),
  });
}

export function emitProviderToPin(cid, providerIds = [], swarmId) {
  backendEvents.emit(EVENT_TYPES.FILE_PIN_PROVIDER, {
    cid,
    providerIds: Array.isArray(providerIds) ? providerIds : [providerIds],
    swarmId,
    timestamp: Date.now(),
  });
}

export function emitProviderToUnpin(cid, providerIds = [], swarmId) {
  backendEvents.emit(EVENT_TYPES.FILE_UNPINNED, {
    cid,
    providerIds: Array.isArray(providerIds) ? providerIds : [providerIds],
    swarmId,
    timestamp: Date.now(),
  });
}

export function emitFileDeleted(fileData, deleterData, swarmData) {
  backendEvents.emit(EVENT_TYPES.FILE_DELETED, {
    file: fileData,
    deleter: deleterData,
    swarm: swarmData,
    timestamp: Date.now(),
  });
}

export function emitFileEncrypted(fileData, encryptionInfo) {
  backendEvents.emit(EVENT_TYPES.FILE_ENCRYPTED, {
    file: fileData,
    encryption: encryptionInfo,
    timestamp: Date.now(),
  });
}

export function emitFileDecrypted(fileData, decryptionInfo) {
  backendEvents.emit(EVENT_TYPES.FILE_DECRYPTED, {
    file: fileData,
    decryption: decryptionInfo,
    timestamp: Date.now(),
  });
}

export function emitFileEncryptionFailed(fileData, error) {
  backendEvents.emit(EVENT_TYPES.FILE_ENCRYPTION_FAILED, {
    file: fileData,
    error: error.message,
    timestamp: Date.now(),
  });
}

export function emitFileDecryptionFailed(fileData, error) {
  backendEvents.emit(EVENT_TYPES.FILE_DECRYPTION_FAILED, {
    file: fileData,
    error: error.message,
    timestamp: Date.now(),
  });
}

// Replication Events
export function emitReplicationStarted(
  sourceProvider,
  targetProvider,
  fileData,
  swarmData
) {
  backendEvents.emit(EVENT_TYPES.REPLICATION_STARTED, {
    sourceProvider,
    targetProvider,
    file: fileData,
    swarm: swarmData,
    timestamp: Date.now(),
  });
}

export function emitReplicationCompleted(
  sourceProvider,
  targetProvider,
  fileData
) {
  backendEvents.emit(EVENT_TYPES.REPLICATION_COMPLETED, {
    sourceProvider,
    targetProvider,
    file: fileData,
    timestamp: Date.now(),
  });
}

export function emitReplicationFailed(
  sourceProvider,
  targetProvider,
  fileData,
  error
) {
  backendEvents.emit(EVENT_TYPES.REPLICATION_FAILED, {
    sourceProvider,
    targetProvider,
    file: fileData,
    error: error.message,
    timestamp: Date.now(),
  });
}

export function emitUserRoleSet(userData, role) {
  backendEvents.emit(EVENT_TYPES.USER_ROLE_SET, {
    user: userData,
    role,
    timestamp: Date.now(),
  });
}

// WebSocket Events
export function emitWsConnection(connectionData) {
  backendEvents.emit(EVENT_TYPES.WS_CONNECTION, {
    ...connectionData,
    timestamp: Date.now(),
  });
}

export function emitWsDisconnection(connectionData) {
  backendEvents.emit(EVENT_TYPES.WS_DISCONNECTION, {
    ...connectionData,
    timestamp: Date.now(),
  });
}

// System Events
export function emitSystemStartup() {
  backendEvents.emit(EVENT_TYPES.SYSTEM_STARTUP, {
    timestamp: Date.now(),
  });
}

// export function emitSystemShutdown() {
//   backendEvents.emit(EVENT_TYPES.SYSTEM_SHUTDOWN, {
//     timestamp: Date.now(),
//   });
// }

// export function emitSystemError(error, context = {}) {
//   backendEvents.emit(EVENT_TYPES.SYSTEM_ERROR, {
//     error: error.message,
//     stack: error.stack,
//     context,
//     timestamp: Date.now(),
//   });
// }

export default backendEvents;
