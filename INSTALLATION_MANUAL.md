# 11Fire Installation Manual

## System Requirements

### Development Environment
- **RAM**: Minimum 4GB (8GB recommended)
- **Disk Space**: At least 1GB free space
- **OS**: macOS, Linux, or Windows 10/11

### Production Server 
- **RAM**: Minimum 2GB (4GB recommended)
- **CPU**: 2 cores minimum ()
- **Disk Space**: 10GB minimum
- **OS**: Ubuntu 20.04/22.04 LTS or similar Linux distribution

---

## Database Setup (MongoDB Atlas)

**STEP 1**

This project uses **MongoDB Atlas** (cloud database) for both development and production.

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for a free account
3. Create a new cluster:
   - Choose a cloud provider (AWS, Google Cloud, or Azure)
   - Select a region close to your users
   - Choose the free tier (M0) for development
4. Create a database user:
   - Go to "Database Access"
   - Click "Add New Database User"
   - Choose authentication method (Username & Password)
   - Set username and password (save these for later)
5. Get connection string:
   - Go to "Database" → "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Example: `mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/11fire?retryWrites=true&w=majority`

---

## Fork and Clone Repository

**STEP 2: Fork the repository**

Since this repository has GitHub Actions configured for automatic Azure deployment, you need to **fork** it to create your own deployment pipeline.

### Step 1: Fork on GitHub

1. Go to https://github.com/suleiyinwin/11Fire_Backend_Listener
2. Click the **"Fork"** button (top right corner)
3. Select your GitHub account as the destination
4. Wait for the fork to complete

### Step 2: Clone Your Forked Repository

## Azure Setup

**STEP 3: Configure Azure resources**

You need two things from Azure:
1. **Azure Active Directory (OAuth)** - For Microsoft authentication
2. **Azure App Service** - For hosting your application

### Azure Active Directory (OAuth)

This section is required for Microsoft authentication functionality.

### Step 1: Create Azure AD App Registration

1. Sign in to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory**
3. Click on **App registrations** in the left menu
4. Click **+ New registration**
5. Fill in the application details:
   - **Name**: 
   - **Supported account types**: Choose "Accounts in any organizational directory (Any Azure AD directory - Multitenant)"
   - **Redirect URI**: 
     - Platform: Web
     - URI: `http://localhost:8080/auth/callback` (for development)
6. Click **Register**

### Step 3: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **+ New client secret**
3. Add a description: 
4. Choose expiration: 24 months (or as required)
5. Click **Add**
6. **IMPORTANT**: Copy the secret **Value** immediately (you won't see it again)

### Step 4: Note Your OAuth Credentials

From your app registration overview page, **save these values**  for the `.env` file:

- **Application (client) ID**: This is your `AZURE_CLIENT_ID` (for OAuth)
- **Client secret**: You copied this in Step 3 - this is your `AZURE_CLIENT_SECRET` (for OAuth)

**Checkpoint:**
- MongoDB Atlas connection string
- Azure OAuth Client ID
- Azure OAuth Client Secret

---

### Azure App Service

This section sets up your Azure App Service for hosting the application using Azure Portal.

#### Sign in to [Azure Portal](https://portal.azure.com)
1. In Azure Portal, search for **App Services**
2. Click **+ Create** → **Web App**
3. Fill in the **Basics** tab:
   - **Subscription**: Choose your subscription
   - **Resource Group**: 
   - **Name**: 
     - This will be your URL: `https://YOUR-APP-NAME.azurewebsites.net`
   - **Runtime stack**: Node 20 LTS
   - **Operating System**: Linux
   - **Region**: 
   - **App Service Plan**: 
4. Click **Review + create** → **Create**
5. Wait for deployment to complete
6. Click **Go to resource**

**📝 Save this information:**
- **App Service name**: (e.g., `11fire-backend-yourname`)
- **URL**: `https://YOUR-APP-NAME.azurewebsites.net`


## Environment Configuration

**Configure your environment variables**

Now that you have all your credentials, let's set up the `.env` file.

### Step 1: Create .env File

```bash
# Make sure you're in the Backend directory
cd 11Fire_Backend_Listener/Backend

# Create .env file from the example template
cp .env.example .env

# Open the file in your text editor
code .env
# or use: nano .env
```

### Step 2: Configure Environment Variables

Fill in your `.env` file with the values you collected from previous steps:

**Important Notes:**
- Use your **MongoDB Atlas connection string** 
- Use your **Azure OAuth credentials** 
- The `AZURE_REDIRECT_URI` should match what you configured in Azure AD

### Generate JWT Secret

For security, generate a strong JWT secret:

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Using OpenSSL (on macOS/Linux)
openssl rand -hex 64

# Copy the output and paste it as your APP_JWT_SECRET
```
### Configure App Service Environment Variables

Set environment variables in Azure App Service (these are separate from your local `.env`):

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your **App Service** (the one you created in STEP 3)
3. In the left menu, click **Configuration** (under Settings)

4. After adding all settings, click **Save** at the top
5. Click **Continue** to restart the app

## Deploy to Azure App Service with GitHub Actions

**This repository includes pre-configured GitHub Actions for automatic deployment to Azure App Service.**

### Update GitHub Workflow File

Update the app name in `.github/workflows/main_elevenfire.yml`:

```yaml
# Open the file and find this section:
env:
  AZURE_WEBAPP_NAME: your-app-name    # Change this to your App Service name
  AZURE_WEBAPP_PACKAGE_PATH: 'Backend'
  NODE_VERSION: '20.x'
```

```bash
# Save and commit:
git add .github/workflows/main_elevenfire.yml
git commit -m "Configure workflow for my Azure App Service"
git push origin main
```

### Step 7.7: Monitor Deployment

1. **Watch GitHub Actions**:
   - Go to: `https://github.com/YOUR-USERNAME/11Fire_Backend_Listener/actions`
   - Click on the latest workflow run
   - Watch the build and deploy steps

2. **Check deployment logs in Azure Portal**:
   - Go to your **App Service** in Azure Portal
   - Click **Log stream** in the left menu (under Monitoring)
   - Watch the live logs as your app deploys

3. **Verify deployment**:
   - Open your browser and go to: `https://YOUR-APP-NAME.azurewebsites.net/health`
   - You should see:
     ```json
     {"status":"healthy","timestamp":"...","environment":"production"}
     ```

### Automatic Deployments

**Future deployments are automatic!**

Every time you push to `main` branch or RP to `main`:
1. GitHub Actions automatically builds your app
2. Runs tests (if configured)
3. Deploys to Azure App Service
4. Your app updates within 2-3 minutes

```bash
# Make changes to your code
# ...

# Commit and push
git add .
git commit -m "Your feature description"
git push origin main

# Deployment starts automatically!
```

---
**Notes: Connection from binary listener to backend must be align with your backend.**

## Connection to frontend

1. Clone the frontend repo first (https://github.com/naycmmkyaw/11Fire_frontend.git).
2. Create .env for frontend. 
3. Add backend endpoint in .env . 
4. Run the project. 

**OR**

**You can use directly https://11-fire-frontend.vercel.app**
