# 11Fire - Decentralized File Storage System

11Fire is a decentralized file storage system built on IPFS (InterPlanetary File System) that enables secure, encrypted file sharing and storage across multiple provider nodes. The system supports multi-tenant swarms with role-based access control and automatic file replication.

## Features

- **Decentralized and Distributed Storage**: Files are replicated across multiple IPFS provider nodes
- **End-to-End Encryption**: All files are encrypted before storage using AES-256-GCM
- **Swarm-Based Organization**: Users can create and join swarms (groups) for collaborative file sharing
- **Role-Based Access Control**: Support for different user roles within swarms
- **Multi-Tenant Architecture**: Isolated data per tenant with Azure AD integration
- **Real-Time Monitoring**: WebSocket-based real-time updates and system monitoring
- **File Migration**: Automatic file migration when providers leave swarms
- **Bootstrap Nodes**: Dedicated bootstrap nodes for initial file ingestion
- **Quota Management**: Storage quota management per provider per swarm

## Architecture

The system consists of three main components:

### 1. Backend API Server (`Backend/`)
- **Technology**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Azure MSAL (Microsoft Authentication Library)
- **Real-time Communication**: WebSocket servers for providers, bootstrap nodes, and monitoring

### 2. Provider Listener (`go_listener/`)
- **Technology**: Go with Gorilla WebSocket
- **Purpose**: Headless agent that connects to IPFS nodes and handles file pinning/unpinning
- **Communication**: WebSocket connection to backend for receiving pin/unpin commands

### 3. Bootstrap Listener (`go_listener_bootstrap/`)
- **Technology**: Go with Gorilla WebSocket
- **Purpose**: Specialized agent for bootstrap nodes that handles initial file ingestion
- **Features**: File upload/download via base64 encoding, optional pinning control

## Project Structure

```
11Fire_Backend_and_Listener/
├── Backend/                          # Main API server
│   ├── src/
│   │   ├── controllers/             # Request handlers
│   │   │   ├── authController.js    # Authentication & user management
│   │   │   ├── fileController.js    # File upload/download/management
│   │   │   ├── swarmController.js   # Swarm creation/management
│   │   │   ├── providerController.js # Provider management
│   │   │   └── ...
│   │   ├── models/                  # MongoDB data models
│   │   │   ├── Auth.js             # User authentication model
│   │   │   ├── FileModel.js        # File metadata model
│   │   │   ├── Swarm.js            # Swarm configuration model
│   │   │   └── ...
│   │   ├── routes/                  # API route definitions
│   │   ├── services/               # Business logic services
│   │   ├── utils/                  # Utility functions (crypto, events, etc.)
│   │   ├── ws/                     # WebSocket handlers
│   │   └── index.js               # Application entry point
│   └── package.json
├── go_listener/                     # Provider node agent
│   ├── listener.go                 # Main Go application
│   ├── go.mod                      # Go module definition
│   └── provider.token             # Provider authentication token
└── go_listener_bootstrap/          # Bootstrap node agent
    ├── listener.go                 # Bootstrap Go application
    └── go.mod                      # Go module definition
```

## Getting Started

### Prerequisites

- **Node.js** (v16 or higher)
- **MongoDB** (v4.4 or higher)
- **Go** (v1.21 or higher)
- **IPFS** (Kubo implementation)


### Installation & Setup

#### 1. Backend Setup

```bash
cd Backend
npm install
npm run dev
```

The server will start on `http://localhost:8080` with the following endpoints:
- REST API: `http://localhost:8080`
- Health Check: `http://localhost:8080/health`
- WebSocket Endpoints:
  - Provider: `ws://localhost:8080/ws/provider`
  - Bootstrap: `ws://localhost:8080/ws/bootstrap`
  - Simulator: `ws://localhost:8080/ws/simulator`

#### 2. IPFS Setup

Install and start IPFS daemon:

```bash
# Install IPFS (if not already installed)
# Visit: https://docs.ipfs.tech/install/

# Initialize IPFS (first time only)
ipfs init

# Start IPFS daemon
ipfs daemon
```

#### 3. Provider Listener Setup

```bash
cd go_listener

# Build the provider listener
go build -o provider-listener .

# Run the provider listener
./provider-listener
```

#### 4. Bootstrap Listener Setup

```bash
cd go_listener_bootstrap

# Build the bootstrap listener
go build -o bootstrap-listener .

# Run the bootstrap listener
./bootstrap-listener
```

## API Documentation

### Authentication Endpoints

```http
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /auth/set-active-swarm/:swarmId
```

### Swarm Management

```http
POST /swarms/create        # Create new swarm
POST /swarms/join          # Join existing swarm
POST /swarms/leave         # Leave swarm
GET  /swarms/mine          # List user's swarms
```

### File Operations

```http
POST /files/upload           # Upload single file
POST /files/folder/upload    # Upload folder
GET  /files/download/:cid    # Download file by CID
POST /files/download-multiple # Download multiple files as ZIP
DELETE /files/delete/:cid    # Delete file
DELETE /files/delete-multiple # Delete multiple files
GET  /files/mine            # List user's files
PATCH /files/rename/:cid    # Rename file
POST /files/share/:cid      # Share file with others
```

### Provider Management

```http
GET  /providers/register    # Register as provider
POST /providers/claim       # Claim provider with peerId
GET  /provider-node/quota   # Get storage quota usage
GET  /provider-node/uptime  # Get uptime statistics
```

## Security Features

### Encryption
- **Algorithm**: AES-256-GCM
- **Key Management**: Per-swarm data keys wrapped with master key
- **File Encryption**: Client-side encryption before upload
- **Metadata Protection**: Sensitive metadata is encrypted

### Access Control
- **Authentication**: Azure AD integration with JWT tokens
- **Authorization**: Role-based access within swarms
- **File Permissions**: Owner-based file access control
- **Tenant Isolation**: Multi-tenant data separation

### Network Security
- **CORS Protection**: Configurable allowed origins
- **WebSocket Security**: Connection validation and heartbeat monitoring
- **Cookie Security**: HttpOnly and Secure cookie settings

## Configuration

### Provider Listener Configuration

Environment variables for Go provider listener:

```bash
export IPFS_BIN=ipfs                    # IPFS binary path
export DELETE_TOKEN_AFTER=false        # Delete token after claiming
export BACKEND_HTTP_URL=http://localhost:8080
export BACKEND_WS_URL=ws://localhost:8080/ws/provider
```

### Bootstrap Listener Configuration

Environment variables for Go bootstrap listener:

```bash
export IPFS_BIN=ipfs                    # IPFS binary path
export PIN_ON_BOOTSTRAP=false          # Whether to pin files on bootstrap
```

## Monitoring & Logging

### Real-Time Events
The system emits various events through WebSocket connections:

- **File Events**: Upload, download, delete, encryption/decryption
- **Provider Events**: Connect, disconnect, registration, claiming
- **Swarm Events**: Create, join, leave, role changes
- **Replication Events**: Start, complete, fail
- **System Events**: Startup, metrics updates

### Logging
- **Backend**: Console logging with timestamps and context
- **Go Listeners**: Structured logging with operation details
- **IPFS Operations**: Detailed logging of pin/unpin operations

##  Health Checks

### Backend Health Check
```http
GET /health
```
Returns system status, timestamp, and environment information.

### IPFS Health Check
Both Go listeners perform IPFS daemon health checks on startup and before operations.

## File Replication Process

1. **Upload**: File is encrypted and uploaded to bootstrap node
2. **Provider Selection**: System selects optimal providers based on:
   - Storage quota availability
   - Network latency (RTT)
   - Provider reliability
   - Load balancing
3. **Replication**: File is replicated to selected providers (default: 3 copies)
4. **Metadata Storage**: File metadata is stored in MongoDB
5. **Event Emission**: Real-time events notify connected clients

## Error Handling

### File Operations
- **Upload Failures**: Automatic retry with different providers
- **Download Failures**: Fallback to alternative providers
- **Provider Failures**: Automatic file migration to healthy providers

### Network Issues
- **WebSocket Reconnection**: Automatic reconnection with exponential backoff
- **IPFS Daemon Issues**: Health checks and error recovery
- **Database Connectivity**: Connection pooling and retry logic

## Development

### Development Mode
```bash
cd Backend
npm run dev
```

This starts the server with nodemon for automatic restarts on file changes.

### Cross-Compilation for Go Listeners

```bash
# For macOS ARM64
GOOS=darwin GOARCH=arm64 go build -o provider-listener-macos .

# For Linux AMD64
GOOS=linux GOARCH=amd64 go build -o provider-listener-linux .

# For Windows AMD64
GOOS=windows GOARCH=amd64 go build -o provider-listener.exe .
```