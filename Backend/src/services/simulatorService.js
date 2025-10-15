import { WebSocketServer } from "ws";
import { EventEmitter } from "events";

/**
 * Comprehensive Simulator Service for 11Fire Backend
 * Broadcasts all backend activities to connected simulator clients
 * compatible to azure deployment
 */
class SimulatorService extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Set();
    this.activityHistory = [];
    this.maxHistorySize = 1000;
    this.isInitialized = false;
  }

  /**
   * Initialize the WebSocket server and start listening for connections
   */
  initialize(wss = null) {
    if (this.isInitialized) {
      console.warn("[Simulator] Service already initialized");
      return;
    }

    // Store reference to WebSocket server (will be set from index.js)
    this.wss = wss;
    this.isInitialized = true;
    console.log("[Simulator] Service initialized (Azure-compatible mode)");
  }

  setWebSocketServer(wss) {
    this.wss = wss;

    this.wss.on("connection", (ws, req) => {
      console.log(
        `[Simulator] New client connected from ${req.socket.remoteAddress}`
      );
      this.clients.add(ws);

      // Send recent activity history to new client
      this.sendActivityHistory(ws);

      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error("[Simulator] Invalid message from client:", error);
        }
      });

      ws.on("close", () => {
        console.log("[Simulator] Client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[Simulator] Client error:", error);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Handle messages from simulator clients
   */
  handleClientMessage(ws, data) {
    switch (data.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        break;
      case "request_history":
        this.sendActivityHistory(ws);
        break;
      case "clear_history":
        this.clearActivityHistory();
        break;
      default:
        console.warn(
          "[Simulator] Unknown message type from client:",
          data.type
        );
    }
  }

  /**
   * Send activity history to a specific client
   */
  sendActivityHistory(ws) {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "activity_history",
          activities: this.activityHistory.slice(-50), // Send last 50 activities
        })
      );
    }
  }

  /**
   * Clear activity history
   */
  clearActivityHistory() {
    this.activityHistory = [];
    this.broadcast({
      type: "history_cleared",
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(data) {
    if (!this.isInitialized || this.clients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      ...data,
      timestamp: data.timestamp || Date.now(),
    });

    // Add to activity history
    this.addToHistory(data);

    // Broadcast to all clients
    this.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error("[Simulator] Failed to send message to client:", error);
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  /**
   * Add activity to history
   */
  addToHistory(activity) {
    this.activityHistory.push({
      ...activity,
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: activity.timestamp || Date.now(),
    });

    // Maintain history size limit
    if (this.activityHistory.length > this.maxHistorySize) {
      this.activityHistory = this.activityHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Swarm/Group related events
   */
  broadcastSwarmCreated(swarmData) {
    this.broadcast({
      type: "swarm_created",
      event: "Group Created",
      swarmId: swarmData.swarmId,
      swarmName: swarmData.name,
      creator: swarmData.creator,
      description: `Group "${swarmData.name}" was created by ${swarmData.creator.username}`,
    });
  }

  broadcastSwarmJoined(userData, swarmData) {
    this.broadcast({
      type: "swarm_joined",
      event: "User Joined Group",
      swarmId: swarmData.swarmId,
      swarmName: swarmData.name,
      user: userData,
      role: userData.role,
      description: `${userData.username} joined group "${swarmData.name}" as ${userData.role}`,
    });
  }

  broadcastSwarmActiveSwitched(data) {
    this.broadcast({
      type: "swarm_active_switched",
      event: "Active Group Switched",
      userId: data.userId,
      username: data.username,
      fromSwarm: data.fromSwarm,
      toSwarm: data.toSwarm,
      description: `${data.username} switched active group ${
        data.fromSwarm ? `from "${data.fromSwarm.name}" ` : ''
      }to "${data.toSwarm.name}"`,
    });
  }

  /**
   * Provider related events
   */
  broadcastProviderConnected(providerData) {
    this.broadcast({
      type: "provider_connected",
      event: "Provider Connected",
      userId: providerData.userId,
      providerId: providerData.peerId,
      username: providerData.username,
      swarms: providerData.swarms,
      activeSwarm: providerData.activeSwarm,
      description: `Provider ${providerData.username} (${
        providerData.peerId
      }) connected${
        providerData.activeSwarm
          ? ` to active swarm ${providerData.activeSwarm}`
          : ""
      }`,
    });
  }

  broadcastProviderDisconnected(providerData) {
    this.broadcast({
      type: "provider_disconnected",
      event: "Provider Disconnected",
      userId: providerData.userId,
      providerId: providerData.peerId,
      username: providerData.username,
      reason: providerData.reason,
      description: `Provider ${providerData.username} disconnected${providerData.reason ? ` (${providerData.reason})` : ''}`,
    });
  }

  broadcastProviderRegistered(providerData) {
    this.broadcast({
      type: "provider_registered",
      event: "Provider Registered",
      userId: providerData.userId,
      providerId: providerData.peerId,
      username: providerData.username,
      description: `Provider ${providerData.username} (${providerData.peerId}) registered for user ${providerData.userId}`,
    });
  }

  broadcastProviderClaimed(providerData) {
    this.broadcast({
      type: "provider_claimed",
      event: "Provider Claimed",
      userId: providerData.userId,
      providerId: providerData.peerId,
      username: providerData.username,
      hasToken: !!providerData.token,
      description: `Provider ${providerData.username} (${providerData.peerId}) claimed by user ${providerData.userId}`,
    });
  }

  broadcastProviderUpdate(providerData) {
    this.broadcast({
      type: "provider_update",
      event: "Provider Update",
      providerId: providerData.id,
      username: providerData.username,
      files: providerData.files,
      swarmId: providerData.swarmId,
      allSwarms: providerData.allSwarms || [],
      description: `Provider ${providerData.username} updated with ${
        providerData.files.length
      } files${
        providerData.swarmId ? ` in swarm ${providerData.swarmId}` : ""
      }`,
    });
  }

  /**
   * File related events
   */
  broadcastFileUploaded(fileData, uploaderData, swarmData) {
    this.broadcast({
      type: "file_uploaded",
      event: "File Uploaded",
      file: {
        cid: fileData.cid,
        name: fileData.name,
        size: fileData.size,
      },
      uploader: uploaderData,
      swarmId: swarmData.swarmId,
      swarmName: swarmData.name,
      replicatedTo: fileData.replicatedTo || [],
      description: `File "${fileData.name}" uploaded by ${uploaderData.username} to group "${swarmData.name}"`,
    });
  }

  broadcastFileDownloaded(fileData, downloaderData) {
    this.broadcast({
      type: "file_downloaded",
      event: "File Downloaded",
      file: {
        cid: fileData.cid,
        name: fileData.name,
      },
      downloader: downloaderData,
      description: `File "${fileData.name}" downloaded by ${downloaderData.username}`,
    });
  }

  /**
   * Encryption related events
   */
  broadcastFileEncrypted(fileData, encryptionInfo) {
    this.broadcast({
      type: "file_encrypted",
      event: "File Encrypted",
      file: {
        cid: fileData.cid,
        name: fileData.name,
        size: fileData.size,
      },
      encryption: encryptionInfo,
      description: `File "${fileData.name}" encrypted using ${
        encryptionInfo.algorithm || "AES-256-GCM"
      }`,
    });
  }

  broadcastFileDecrypted(fileData, decryptionInfo) {
    this.broadcast({
      type: "file_decrypted",
      event: "File Decrypted",
      file: {
        cid: fileData.cid,
        name: fileData.name,
      },
      decryption: decryptionInfo,
      description: `File "${fileData.name}" successfully decrypted`,
    });
  }

  broadcastEncryptionEvent(eventType, fileData, details) {
    this.broadcast({
      type: "encryption_event",
      event: eventType,
      file: fileData,
      details: details,
      description: `Encryption event: ${eventType} for file "${fileData.name}"`,
    });
  }

  /**
   * Replication related events
   */
  broadcastReplicationStarted(
    sourceProvider,
    targetProvider,
    fileData,
    swarmData
  ) {
    this.broadcast({
      type: "replication_started",
      event: "File Replication Started",
      sourceProvider: sourceProvider,
      targetProvider: targetProvider,
      file: {
        cid: fileData.cid,
        name: fileData.name,
      },
      swarmId: swarmData.swarmId,
      swarmName: swarmData.name,
      description: `Replicating "${fileData.name}" from ${sourceProvider.username} to ${targetProvider.username}`,
    });
  }

  broadcastReplicationCompleted(sourceProvider, targetProvider, fileData) {
    this.broadcast({
      type: "replication_completed",
      event: "File Replication Completed",
      sourceProvider: sourceProvider,
      targetProvider: targetProvider,
      file: {
        cid: fileData.cid,
        name: fileData.name,
      },
      description: `Successfully replicated "${fileData.name}" to ${targetProvider.username}`,
    });
  }

  /**
   * Bootstrap related events
   */
  broadcastBootstrapActivity(bootstrapData, action) {
    this.broadcast({
      type: "bootstrap_activity",
      event: "Bootstrap Activity",
      bootstrap: bootstrapData,
      action: action,
      description: `Bootstrap node ${bootstrapData.peerId} performed action: ${action}`,
    });
  }

  /**
   * Authentication related events
   */
  broadcastUserAuthenticated(userData) {
    this.broadcast({
      type: "user_authenticated",
      event: "User Login",
      user: userData,
      description: `User ${userData.username} authenticated successfully`,
    });
  }

  broadcastUserLogout(userData) {
    this.broadcast({
      type: "user_logout",
      event: "User Logout",
      user: userData,
      description: `User ${userData.username} logged out`,
    });
  }

  /**
   * System events
   */
  broadcastSystemEvent(eventType, message, data = {}) {
    this.broadcast({
      type: "system_event",
      event: eventType,
      message: message,
      data: data,
      description: message,
    });
  }

  /**
   * Network topology update
   */
  broadcastNetworkTopology(topology) {
    this.broadcast({
      type: "network_topology",
      event: "Network Topology Update",
      topology: topology,
      description: "Network topology updated",
    });
  }

  // Storage metrics event
  broadcastStorageEvent(eventData) {
    const activity = {
      category: "storage",
      type: eventData.type,
      data: eventData.data,
      timestamp: Date.now(),
    };

    this.addToHistory(activity);
    this.broadcast(activity);
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      activityHistorySize: this.activityHistory.length,
      isInitialized: this.isInitialized,
      uptime: this.isInitialized ? Date.now() - this.initTime : 0,
    };
  }

  /**
   * Shutdown the service
   */
  shutdown() {
    if (this.wss) {
      this.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.close(1000, "Server shutting down");
        }
      });
      this.wss.close();
      this.isInitialized = false;
      console.log("[Simulator] Service shutdown completed");
    }
  }
}

// Create singleton instance
const simulatorService = new SimulatorService();

export default simulatorService;
