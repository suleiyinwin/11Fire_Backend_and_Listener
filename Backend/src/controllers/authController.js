import Auth from "../models/Auth.js";
import { msalClient } from "../lib/msalClient.js";
import { issueSession, updateSession, clearSession } from "../utils/session.js";
import { upsertMembershipForUser } from "../utils/membershipUtils.js";
import { generateProviderClaimForUser } from "../utils/providerClaim.js";
import { setQuotaForActiveSwarm } from "../utils/membershipUtils.js";
import { bytesToGb } from "../utils/units.js";
import { ResponseMode } from '@azure/msal-node';

const BASE_SCOPES = ["openid", "profile", "email"];

// Safari cookie initialization endpoint
export async function initSession(req, res) {
  try {
    // Set a temporary cookie to establish the domain relationship
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 60000, // 1 minute
    };
    
    // Only add domain if it's a valid non-empty string
    if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN.trim()) {
      cookieOptions.domain = process.env.COOKIE_DOMAIN.trim();
    }
    
    res.cookie('safari_init', 'true', cookieOptions);
    
    res.json({ 
      message: 'Session initialized', 
      domain: req.get('host'),
      origin: req.get('origin'),
      userAgent: req.get('user-agent')?.includes('Safari') ? 'Safari detected' : 'Other browser'
    });
  } catch (err) {
    res.status(500).json({ error: 'Session initialization failed' });
  }
}

// Cookie test endpoint
export async function testCookies(req, res) {
  try {
    // Set a test cookie
    res.cookie('test_cookie', 'test_value', {
      httpOnly: false, // Make it readable by JS for testing
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 60000, // 1 minute
    });
    
    res.json({
      message: 'Test cookie set',
      receivedCookies: req.cookies,
      headers: {
        userAgent: req.get('user-agent'),
        origin: req.get('origin'),
        referer: req.get('referer'),
        host: req.get('host'),
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Cookie test failed' });
  }
}

export async function startLogin(req, res, next) {
  try {
    // Generate state for CSRF protection (required for Safari/Mobile)
    const state = Math.random().toString(36).substring(2, 15);
    
    const url = await msalClient.getAuthCodeUrl({
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state: state, // Critical for Safari/Mobile browsers
      prompt: 'select_account', // Better UX for multi-account scenarios
      responseMode: ResponseMode.QUERY,
    });
    
    // Store state in session for validation (optional but recommended)
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax', // Lax is okay for CSRF tokens
      maxAge: 10 * 60 * 1000, // 10 minutes
    });
    
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

export async function callback(req, res, next) {
  try {
    const { code, state } = req.query; //Receives the code from Microsoft.
    if (!code)
      return res.status(400).json({ error: "Missing authorization code" });

    // Validate state parameter (CSRF protection)
    const storedState = req.cookies?.oauth_state;
    if (state && storedState && state !== storedState) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    // Clear the state cookie
    res.clearCookie('oauth_state');

    //exchange code for tokens and user info (idTokenClaims).
    const tokenResp = await msalClient.acquireTokenByCode({
      code,
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state: state, // Include state in token exchange
    });

    const c = tokenResp.idTokenClaims || {};

    const email = c.preferred_username || c.upn || null;
    const username = c.name || email || "User";

    // Creates or updates the user document
    const user = await Auth.findOneAndUpdate(
      { "ms.oid": c.oid, "ms.tid": c.tid },
      {
        $setOnInsert: { username },
        $set: {
          email,
          ms: {
            oid: c.oid,
            tid: c.tid, //Store tenant for isolation
            sub: c.sub,
            upn: c.upn,
            preferredUsername: c.preferred_username,
            name: c.name,
          },
        },
      },
      { upsert: true, new: true }
    );

    // try {
    //   await generateProviderClaimForUser(user._id);
    // } catch (e) {
    //   console.error("Failed to generate provider claim token:", e);
    // }

    issueSession(res, {
      uid: String(user._id),
      ms: { oid: c.oid, tid: c.tid },
      activeSwarm: user.activeSwarm || null,
    });

    return res.redirect(process.env.POST_LOGIN_REDIRECT || "/");
  } catch (err) {
    next(err);
  }
}

//UI calls this (auth required) to fetch existing unexpired token metadata or regenerate one
export async function mintProviderClaimToken(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const { renew = false } = req.body || {};
    const doc = await Auth.findById(req.user.uid).select("providerClaim");
    const now = new Date();

    // if (!renew && doc?.providerClaim && !doc.providerClaim.usedAt && doc.providerClaim.expiresAt > now) {
    //   return res.status(200).json({
    //     token: null,                // we don't store plaintext
    //     expiresAt: doc.providerClaim.expiresAt,
    //     alreadyExists: true,
    //   });
    // }

    const { token, expiresAt } = await generateProviderClaimForUser(req.user.uid);
    return res.json({ token, expiresAt, alreadyExists: false });
  } catch (err) {
    console.error("mintProviderClaimToken failed:", err);
    res.status(500).json({ error: "Failed to mint provider claim token" });
  }
}

//add role in swarm
export async function upsertMembership(req, res, next) {
  try {
    const { swarmId, role, quotaBytes } = req.body || {};
    if (!swarmId || !["user", "provider"].includes(role)) {
      return res
        .status(400)
        .json({ error: "swarmId and valid role are required" });
    }

    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    await upsertMembershipForUser(user, { swarmId, role, quotaBytes });

    res.json({ ok: true, memberships: user.memberships });
  } catch (err) {
    next(err);
  }
}

//active swarm (for UI)
export async function setActiveSwarm(req, res, next) {
  try {
    const { swarmId } = req.body || {};
    if (!swarmId) return res.status(400).json({ error: "swarmId is required" });

    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const mem = user.getMembership(swarmId);
    if (!mem)
      return res.status(403).json({ error: "Not a member of this swarm" });

    user.activeSwarm = swarmId;
    await user.save();

    const SwarmModel = (await import("../models/Swarm.js")).default;
    const swarm = await SwarmModel.findById(swarmId).select("name").lean();

    res.json({ ok: true, activeSwarm: swarmId, swarmName: swarm?.name || null, role: mem.role });
  } catch (err) {
    next(err);
  }
}

//active swarm (for backend use)
export async function setActiveSwarmBackend(userId, swarmId) {
  if (!userId || !swarmId) throw new Error("userId and swarmId are required");

  const user = await Auth.findById(userId);
  if (!user) throw new Error("User not found");

  const mem = user.getMembership(swarmId);
  if (!mem) throw new Error("Not a member of this swarm");

  user.activeSwarm = swarmId;
  await user.save();
  return { activeSwarm: swarmId, role: mem.role };
}

//user information
export async function me(req, res) {
  try {
    // console.log("Session cookie:", req.cookies?.sid);
    // console.log("Decoded user from JWT:", req.user);

    if (!req.user?.uid) return res.status(200).json({ user: null });

    const doc = await Auth.findById(req.user.uid).select(
      "username email ms memberships activeSwarm createdAt"
    );

    // console.log("Fetched user from DB:", doc);
    res.json({ user: doc });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

//logout
export async function logout(_req, res) {
  clearSession(res);
  res.json({ ok: true });
}

//set quota for active swarm
// After provider joined/created, they can set quota for their ACTIVE swarm
export async function setActiveSwarmQuota(req, res, next) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    const { quotaGB, quotaBytes } = req.body || {};

    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const result = await setQuotaForActiveSwarm(user, { quotaGB, quotaBytes });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const m = result.membership;

    const SwarmModel = (await import("../models/Swarm.js")).default;
    const swarm = await SwarmModel.findById(user.activeSwarm).select("name").lean();

    return res.json({
      ok: true,
      swarmId: String(user.activeSwarm),
      swarmName: swarm?.name || null,
      quotaBytes: m.quotaBytes,      
      quotaGB: bytesToGb(m.quotaBytes),   
      role: m.role,
    });
  } catch (err) {
    next(err);
  }
}
