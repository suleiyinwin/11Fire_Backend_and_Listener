import simulatorService from './simulatorService.js';
import backendEvents, { EVENT_TYPES } from '../utils/eventSystem.js';

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
      console.warn('[EventHandler] Service already initialized');
      return;
    }

    this.setupEventListeners();
    this.isInitialized = true;
    console.log('[EventHandler] Service initialized with event listeners');
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Swarm Events
    this.addListener(EVENT_TYPES.SWARM_CREATED, this.handleSwarmCreated.bind(this));
    this.addListener(EVENT_TYPES.SWARM_JOINED, this.handleSwarmJoined.bind(this));
    this.addListener(EVENT_TYPES.SWARM_LEFT, this.handleSwarmLeft.bind(this));

    // Provider Events
    this.addListener(EVENT_TYPES.PROVIDER_CONNECTED, this.handleProviderConnected.bind(this));
    this.addListener(EVENT_TYPES.PROVIDER_DISCONNECTED, this.handleProviderDisconnected.bind(this));
    this.addListener(EVENT_TYPES.PROVIDER_REGISTERED, this.handleProviderRegistered.bind(this));
    this.addListener(EVENT_TYPES.PROVIDER_CLAIMED, this.handleProviderClaimed.bind(this));

    // File Events
    this.addListener(EVENT_TYPES.FILE_UPLOADED, this.handleFileUploaded.bind(this));
    this.addListener(EVENT_TYPES.FILE_DOWNLOADED, this.handleFileDownloaded.bind(this));
    this.addListener(EVENT_TYPES.FILE_PIN_PROVIDER, this.handleFilePinned.bind(this));
    this.addListener(EVENT_TYPES.FILE_UNPINNED, this.handleFileUnpinned.bind(this));
    this.addListener(EVENT_TYPES.FILE_ENCRYPTED, this.handleFileEncrypted.bind(this));
    this.addListener(EVENT_TYPES.FILE_DECRYPTED, this.handleFileDecrypted.bind(this));
    this.addListener(EVENT_TYPES.FILE_ENCRYPTION_FAILED, this.handleFileEncryptionFailed.bind(this));
    this.addListener(EVENT_TYPES.FILE_DECRYPTION_FAILED, this.handleFileDecryptionFailed.bind(this));

    // Replication Events
    this.addListener(EVENT_TYPES.REPLICATION_STARTED, this.handleReplicationStarted.bind(this));
    this.addListener(EVENT_TYPES.REPLICATION_COMPLETED, this.handleReplicationCompleted.bind(this));
    this.addListener(EVENT_TYPES.REPLICATION_FAILED, this.handleReplicationFailed.bind(this));

    // Bootstrap Events
    this.addListener(EVENT_TYPES.BOOTSTRAP_CONNECTED, this.handleBootstrapConnected.bind(this));
    this.addListener(EVENT_TYPES.BOOTSTRAP_DISCONNECTED, this.handleBootstrapDisconnected.bind(this));
    this.addListener(EVENT_TYPES.BOOTSTRAP_UPLOAD, this.handleBootstrapUpload.bind(this));
    this.addListener(EVENT_TYPES.BOOTSTRAP_DOWNLOAD, this.handleBootstrapDownload.bind(this));

    // Authentication Events
    this.addListener(EVENT_TYPES.USER_AUTHENTICATED, this.handleUserAuthenticated.bind(this));
    this.addListener(EVENT_TYPES.USER_LOGOUT, this.handleUserLogout.bind(this));
    this.addListener(EVENT_TYPES.USER_REGISTERED, this.handleUserRegistered.bind(this));
    this.addListener(EVENT_TYPES.USER_ROLE_SET, this.handleUserRoleSet.bind(this));

    // System Events
    this.addListener(EVENT_TYPES.SYSTEM_STARTUP, this.handleSystemStartup.bind(this));
    // this.addListener(EVENT_TYPES.SYSTEM_SHUTDOWN, this.handleSystemShutdown.bind(this));
    // this.addListener(EVENT_TYPES.SYSTEM_ERROR, this.handleSystemError.bind(this));

    // WebSocket Events
    this.addListener(EVENT_TYPES.WS_CONNECTION, this.handleWsConnection.bind(this));
    this.addListener(EVENT_TYPES.WS_DISCONNECTION, this.handleWsDisconnection.bind(this));
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
    console.log('[EventHandler] Swarm created:', data);
    simulatorService.broadcastSwarmCreated({
      swarmId: data.swarmId,
      name: data.name,
      creator: data.creator
    });
  }

  handleSwarmJoined(data) {
    console.log('[EventHandler] User joined swarm:', data);
    simulatorService.broadcastSwarmJoined(data.user, data.swarm);
  }

  handleSwarmLeft(data) {
    console.log('[EventHandler] User left swarm:', data);
    simulatorService.broadcastSystemEvent(
      'User Left Group',
      `${data.user.username} left group "${data.swarm.name}"`,
      data
    );
  }

  handleProviderConnected(data) {
    console.log('[EventHandler] Provider connected:', data);
    simulatorService.broadcastProviderConnected(data);
  }

  handleProviderDisconnected(data) {
    console.log('[EventHandler] Provider disconnected:', data);
    simulatorService.broadcastProviderDisconnected(data);
  }

  handleProviderRegistered(data) {
    console.log('[EventHandler] Provider registered:', data);
    simulatorService.broadcastSystemEvent(
      'Provider Registered',
      `Provider ${data.peerId} registered for user ${data.userId}`,
      data
    );
  }

  handleProviderClaimed(data) {
    console.log('[EventHandler] Provider claimed:', data);
    simulatorService.broadcastSystemEvent(
      'Provider Claimed',
      `Provider ${data.peerId} claimed by user ${data.userId}`,
      data
    );
  }

  handleFileUploaded(data) {
    console.log('[EventHandler] File uploaded:', data);
    simulatorService.broadcastFileUploaded(data.file, data.uploader, data.swarm);
  }

  handleFileDownloaded(data) {
    console.log('[EventHandler] File downloaded:', data);
    simulatorService.broadcastFileDownloaded(data.file, data.downloader);
  }

  handleFilePinned(data) {
    console.log('[EventHandler] File pinned:', data);
    simulatorService.broadcastSystemEvent(
      'File Pinned',
      `File ${data.cid} pinned by provider ${data.providerId}`,
      data
    );
  }

  handleFileUnpinned(data) {
    console.log('[EventHandler] File unpinned:', data);
    simulatorService.broadcastSystemEvent(
      'File Unpinned',
      `File ${data.cid} unpinned by provider ${data.providerId}`,
      data
    );
  }

  handleFileEncrypted(data) {
    console.log('[EventHandler] File encrypted:', data);
    simulatorService.broadcastSystemEvent(
      'File Encrypted',
      `File "${data.file.name}" encrypted using ${data.encryption.algorithm || 'AES-256-GCM'}`,
      {
        file: data.file,
        algorithm: data.encryption.algorithm,
        keyDerivation: data.encryption.keyDerivation || 'PBKDF2',
        timestamp: data.timestamp
      }
    );
  }

  handleFileDecrypted(data) {
    console.log('[EventHandler] File decrypted:', data);
    simulatorService.broadcastSystemEvent(
      'File Decrypted',
      `File "${data.file.name}" successfully decrypted`,
      {
        file: data.file,
        decryptionTime: data.decryption.decryptionTime,
        timestamp: data.timestamp
      }
    );
  }

  handleFileEncryptionFailed(data) {
    console.log('[EventHandler] File encryption failed:', data);
    simulatorService.broadcastSystemEvent(
      'File Encryption Failed',
      `Failed to encrypt file "${data.file.name}": ${data.error}`,
      data
    );
  }

  handleFileDecryptionFailed(data) {
    console.log('[EventHandler] File decryption failed:', data);
    simulatorService.broadcastSystemEvent(
      'File Decryption Failed',
      `Failed to decrypt file "${data.file.name}": ${data.error}`,
      data
    );
  }

  handleReplicationStarted(data) {
    console.log('[EventHandler] Replication started:', data);
    simulatorService.broadcastReplicationStarted(
      data.sourceProvider,
      data.targetProvider,
      data.file,
      data.swarm
    );
  }

  handleReplicationCompleted(data) {
    console.log('[EventHandler] Replication completed:', data);
    simulatorService.broadcastReplicationCompleted(
      data.sourceProvider,
      data.targetProvider,
      data.file
    );
  }

  handleReplicationFailed(data) {
    console.log('[EventHandler] Replication failed:', data);
    simulatorService.broadcastSystemEvent(
      'Replication Failed',
      `Failed to replicate file ${data.file.name} from ${data.sourceProvider.username} to ${data.targetProvider.username}: ${data.error}`,
      data
    );
  }

  handleBootstrapConnected(data) {
    console.log('[EventHandler] Bootstrap connected:', data);
    simulatorService.broadcastBootstrapActivity(data.bootstrap, 'connected');
  }

  handleBootstrapDisconnected(data) {
    console.log('[EventHandler] Bootstrap disconnected:', data);
    simulatorService.broadcastBootstrapActivity(data.bootstrap, 'disconnected');
  }

  handleBootstrapUpload(data) {
    console.log('[EventHandler] Bootstrap upload:', data);
    simulatorService.broadcastBootstrapActivity(data.bootstrap, `uploaded ${data.file.name}`);
  }

  handleBootstrapDownload(data) {
    console.log('[EventHandler] Bootstrap download:', data);
    simulatorService.broadcastBootstrapActivity(data.bootstrap, `downloaded ${data.file.name}`);
  }

  handleUserAuthenticated(data) {
    console.log('[EventHandler] User authenticated:', data);
    simulatorService.broadcastUserAuthenticated(data.user);
  }

  handleUserLogout(data) {
    console.log('[EventHandler] User logout:', data);
    simulatorService.broadcastUserLogout(data.user);
  }

  handleUserRegistered(data) {
    console.log('[EventHandler] User registered:', data);
    simulatorService.broadcastSystemEvent(
      'User Registered',
      `New user ${data.user.username} registered`,
      data
    );
  }

  handleUserRoleSet(data) {
    console.log('[EventHandler] User role set:', data);
    simulatorService.broadcastSystemEvent(
      'User Role Set',
      `User ${data.user.username} role set to ${data.role}`,
      data
    );
  }

  handleSystemStartup(data) {
    console.log('[EventHandler] System startup:', data);
    simulatorService.broadcastSystemEvent(
      'System Startup',
      '11Fire Backend System Started',
      data
    );
  }

  // handleSystemShutdown(data) {
  //   console.log('[EventHandler] System shutdown:', data);
  //   simulatorService.broadcastSystemEvent(
  //     'System Shutdown',
  //     '11Fire Backend System Shutting Down',
  //     data
  //   );
  // }

  // handleSystemError(data) {
  //   console.log('[EventHandler] System error:', data);
  //   simulatorService.broadcastSystemEvent(
  //     'System Error',
  //     `System error: ${data.error}`,
  //     data
  //   );
  // }

  handleWsConnection(data) {
    console.log('[EventHandler] WebSocket connection:', data);
    simulatorService.broadcastSystemEvent(
      'WebSocket Connection',
      `New WebSocket connection from ${data.type || 'unknown'} client`,
      data
    );
  }

  handleWsDisconnection(data) {
    console.log('[EventHandler] WebSocket disconnection:', data);
    simulatorService.broadcastSystemEvent(
      'WebSocket Disconnection',
      `WebSocket client disconnected: ${data.reason || 'unknown reason'}`,
      data
    );
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      activeListeners: this.eventListeners.size,
      eventTypes: Array.from(this.eventListeners.keys())
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
      console.log('[EventHandler] Service shutdown completed');
    }
  }
}

// Create singleton instance
const eventHandlerService = new EventHandlerService();

export default eventHandlerService;
