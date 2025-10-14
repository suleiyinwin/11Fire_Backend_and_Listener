import simulatorService from "./simulatorService.js";
import backendEvents, { EVENT_TYPES } from "../utils/eventSystem.js";

/**
 * Event Handler Service
 * Bridges backend events to simulator broadcasts
 */
class EventHandlerService {
  constructor() {
    this.isInitialized = false;
    this.eventListeners = new Map();
  }

  /**
   * Initialize event listeners
   */
  initialize() {
    if (this.isInitialized) {
      console.warn("[EventHandler] Service already initialized");
      return;
    }

    this.setupEventListeners();
    this.isInitialized = true;
    console.log("[EventHandler] Service initialized with event listeners");
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Swarm Events
    this.addListener(
      EVENT_TYPES.SWARM_CREATED,
      this.handleSwarmCreated.bind(this)
    );
    this.addListener(
      EVENT_TYPES.SWARM_JOINED,
      this.handleSwarmJoined.bind(this)
    );
    this.addListener(EVENT_TYPES.SWARM_LEFT, this.handleSwarmLeft.bind(this));

    // Provider Events
    this.addListener(
      EVENT_TYPES.PROVIDER_CONNECTED,
      this.handleProviderConnected.bind(this)
    );
    this.addListener(
      EVENT_TYPES.PROVIDER_DISCONNECTED,
      this.handleProviderDisconnected.bind(this)
    );
    this.addListener(
      EVENT_TYPES.PROVIDER_REGISTERED,
      this.handleProviderRegistered.bind(this)
    );
    this.addListener(
      EVENT_TYPES.PROVIDER_CLAIMED,
      this.handleProviderClaimed.bind(this)
    );

    // File Events
    this.addListener(
      EVENT_TYPES.FILE_UPLOADED,
      this.handleFileUploaded.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_DOWNLOADED,
      this.handleFileDownloaded.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_DELETED,
      this.handleFileDeleted.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_PIN_PROVIDER,
      this.handleFilePinned.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_UNPINNED,
      this.handleFileUnpinned.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_ENCRYPTED,
      this.handleFileEncrypted.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_DECRYPTED,
      this.handleFileDecrypted.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_ENCRYPTION_FAILED,
      this.handleFileEncryptionFailed.bind(this)
    );
    this.addListener(
      EVENT_TYPES.FILE_DECRYPTION_FAILED,
      this.handleFileDecryptionFailed.bind(this)
    );

    // Replication Events
    this.addListener(
      EVENT_TYPES.REPLICATION_STARTED,
      this.handleReplicationStarted.bind(this)
    );
    this.addListener(
      EVENT_TYPES.REPLICATION_COMPLETED,
      this.handleReplicationCompleted.bind(this)
    );
    this.addListener(
      EVENT_TYPES.REPLICATION_FAILED,
      this.handleReplicationFailed.bind(this)
    );

    // Authentication Events
    this.addListener(
      EVENT_TYPES.USER_ROLE_SET,
      this.handleUserRoleSet.bind(this)
    );

    // System Events
    this.addListener(
      EVENT_TYPES.SYSTEM_STARTUP,
      this.handleSystemStartup.bind(this)
    );
    // this.addListener(EVENT_TYPES.SYSTEM_SHUTDOWN, this.handleSystemShutdown.bind(this));
    // this.addListener(EVENT_TYPES.SYSTEM_ERROR, this.handleSystemError.bind(this));

    // WebSocket Events
    this.addListener(
      EVENT_TYPES.WS_CONNECTION,
      this.handleWsConnection.bind(this)
    );
    this.addListener(
      EVENT_TYPES.WS_DISCONNECTION,
      this.handleWsDisconnection.bind(this)
    );

    // Storage Metrics Event
    this.addListener(
      EVENT_TYPES.STORAGE_METRICS_UPDATED,
      this.handleStorageMetricsUpdated.bind(this)
    );
  }

  /**
   * Add event listener and track it
   */
  addListener(eventType, handler) {
    backendEvents.on(eventType, handler);
    this.eventListeners.set(eventType, handler);
  }

  /**
   * Event Handlers
   */

  handleSwarmCreated(data) {
    console.log("[EventHandler] Swarm created:", data);
    simulatorService.broadcastSwarmCreated({
      swarmId: data.swarmId,
      name: data.name,
      creator: data.creator,
    });
  }

  handleSwarmJoined(data) {
    console.log("[EventHandler] User joined swarm:", data);
    simulatorService.broadcastSwarmJoined(data.user, data.swarm);
  }

  handleSwarmLeft(data) {
    console.log("[EventHandler] User left swarm:", data);
    simulatorService.broadcastSystemEvent(
      "User Left Group",
      `${data.user.username} left group "${data.swarm.name}"`,
      data
    );
  }

  handleProviderConnected(data) {
    console.log("[EventHandler] Provider connected:", data);
    simulatorService.broadcastProviderConnected(data);
  }

  handleProviderDisconnected(data) {
    console.log("[EventHandler] Provider disconnected:", data);
    simulatorService.broadcastProviderDisconnected(data);
  }

  handleProviderRegistered(data) {
    console.log("[EventHandler] Provider registered:", data);
    simulatorService.broadcastSystemEvent(
      "Provider Registered",
      `Provider ${data.peerId} registered for user ${data.userId}`,
      data
    );
  }

  handleProviderClaimed(data) {
    console.log("[EventHandler] Provider claimed:", data);
    simulatorService.broadcastSystemEvent(
      "Provider Claimed",
      `Provider ${data.peerId} claimed by user ${data.userId}`,
      data
    );
  }

  handleFileUploaded(data) {
    console.log("[EventHandler] File uploaded:", data);
    simulatorService.broadcastFileUploaded(
      data.file,
      data.uploader,
      data.swarm
    );
  }

  handleFileDownloaded(data) {
    console.log("[EventHandler] File downloaded:", data);
    simulatorService.broadcastFileDownloaded(data.file, data.downloader);
  }

  handleFileDeleted(data) {
    console.log("[EventHandler] File deleted:", data);
    simulatorService.broadcastSystemEvent(
      "File Deleted",
      `File "${data.file.name}" deleted by ${data.deleter.username}`,
      data
    );
  }

  handleFilePinned(data) {
    console.log("[EventHandler] File pinned:", data);
    simulatorService.broadcastSystemEvent(
      "File Pinned",
      `File "${data.filename}" pinned by ${data.username}`,
      data
    );
  }

  handleFileUnpinned(data) {
    console.log("[EventHandler] File unpinned:", data);
    simulatorService.broadcastSystemEvent(
      "File Unpinned",
      `File "${data.filename}" unpinned by ${data.username}`,
      data
    );
  }

  handleFileEncrypted(data) {
    console.log("[EventHandler] File encrypted:", data);
    simulatorService.broadcastSystemEvent(
      "File Encrypted",
      `File "${data.filename}" encrypted by ${data.username} using ${
        data.encryption.algorithm || "AES-256-GCM"
      }`,
      {
        filename: data.filename,
        fileSize: data.fileSize,
        username: data.username,
        userId: data.userId,
        swarmId: data.swarmId,
        swarmName: data.swarmName,
        description: data.description,
        algorithm: data.encryption.algorithm,
        keyDerivation: data.encryption.keyDerivation || "PBKDF2",
        timestamp: data.timestamp,
      }
    );
  }

  handleFileDecrypted(data) {
    console.log("[EventHandler] File decrypted:", data);
    simulatorService.broadcastSystemEvent(
      "File Decrypted",
      `File "${data.filename}" successfully decrypted by ${data.username}`,
      {
        filename: data.filename,
        fileSize: data.fileSize,
        username: data.username,
        userId: data.userId,
        swarmId: data.swarmId,
        swarmName: data.swarmName,
        description: data.description,
        decryptionTime: data.decryption.decryptionTime,
        timestamp: data.timestamp,
      }
    );
  }

  handleFileEncryptionFailed(data) {
    console.log("[EventHandler] File encryption failed:", data);
    simulatorService.broadcastSystemEvent(
      "File Encryption Failed",
      `Failed to encrypt file "${data.filename}" by ${data.username}: ${data.error}`,
      {
        filename: data.filename,
        fileSize: data.fileSize,
        username: data.username,
        userId: data.userId,
        swarmId: data.swarmId,
        swarmName: data.swarmName,
        description: data.description,
        error: data.error,
        timestamp: data.timestamp,
      }
    );
  }

  handleFileDecryptionFailed(data) {
    console.log("[EventHandler] File decryption failed:", data);
    simulatorService.broadcastSystemEvent(
      "File Decryption Failed",
      `Failed to decrypt file "${data.filename}" by ${data.username}: ${data.error}`,
      {
        filename: data.filename,
        fileSize: data.fileSize,
        username: data.username,
        userId: data.userId,
        swarmId: data.swarmId,
        swarmName: data.swarmName,
        description: data.description,
        error: data.error,
        timestamp: data.timestamp,
      }
    );
  }

  handleReplicationStarted(data) {
    console.log("[EventHandler] Replication started:", data);
    simulatorService.broadcastReplicationStarted(
      data.sourceProvider,
      data.targetProvider,
      data.file,
      data.swarm
    );
  }

  handleReplicationCompleted(data) {
    console.log("[EventHandler] Replication completed:", data);
    simulatorService.broadcastReplicationCompleted(
      data.sourceProvider,
      data.targetProvider,
      data.file
    );
  }

  handleReplicationFailed(data) {
    console.log("[EventHandler] Replication failed:", data);
    simulatorService.broadcastSystemEvent(
      "Replication Failed",
      `Failed to replicate file ${data.file.name} from ${data.sourceProvider.username} to ${data.targetProvider.username}: ${data.error}`,
      data
    );
  }

  handleUserRoleSet(data) {
    console.log("[EventHandler] User role set:", data);
    simulatorService.broadcastSystemEvent(
      "User Role Set",
      `User ${data.user.username} role set to ${data.role}`,
      data
    );
  }

  handleSystemStartup(data) {
    console.log("[EventHandler] System startup:", data);
    simulatorService.broadcastSystemEvent(
      "System Startup",
      "11Fire Backend System Started",
      data
    );
  }

  handleWsConnection(data) {
    console.log("[EventHandler] WebSocket connection:", data);
    simulatorService.broadcastSystemEvent(
      "WebSocket Connection",
      `New WebSocket connection from ${data.type || "unknown"} client`,
      data
    );
  }

  handleWsDisconnection(data) {
    console.log("[EventHandler] WebSocket disconnection:", data);
    simulatorService.broadcastSystemEvent(
      "WebSocket Disconnection",
      `WebSocket client disconnected: ${data.reason || "unknown reason"}`,
      data
    );
  }

  // New handler for storage metrics updates
  handleStorageMetricsUpdated(metricsData) {
    console.log("[EventHandler] Storage metrics updated:", metricsData);
    simulatorService.broadcastStorageEvent({
      type: "storage_metrics_updated",
      data: metricsData,
    });
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      activeListeners: this.eventListeners.size,
      eventTypes: Array.from(this.eventListeners.keys()),
    };
  }

  /**
   * Shutdown the service
   */
  shutdown() {
    if (this.isInitialized) {
      // Remove all event listeners
      for (const [eventType, handler] of this.eventListeners.entries()) {
        backendEvents.removeListener(eventType, handler);
      }
      this.eventListeners.clear();
      this.isInitialized = false;
      console.log("[EventHandler] Service shutdown completed");
    }
  }
}

// Create singleton instance
const eventHandlerService = new EventHandlerService();

export default eventHandlerService;
