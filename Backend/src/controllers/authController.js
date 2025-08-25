import Auth from "../models/Auth.js";
import { msalClient } from "../lib/msalClient.js";
import { issueSession, updateSession, clearSession } from "../utils/session.js";
import { upsertMembershipForUser } from "../utils/membershipUtils.js";
import { generateProviderClaimForUser } from "../utils/providerClaim.js";

const BASE_SCOPES = ["openid", "profile", "email"];

export async function startLogin(_req, res, next) {
  try {
    const url = await msalClient.getAuthCodeUrl({
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

export async function callback(req, res, next) {
  try {
    const { code } = req.query; //Receives the code from Microsoft.
    if (!code)
      return res.status(400).json({ error: "Missing authorization code" });

    //exchange code for tokens and user info (idTokenClaims).
    const tokenResp = await msalClient.acquireTokenByCode({
      code,
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    const c = tokenResp.idTokenClaims || {};
    if (c.tid !== process.env.AZURE_TENANT_ID)
      return res.status(403).json({ error: "Wrong tenant" });

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
            tid: c.tid,
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

    if (!renew && doc?.providerClaim && !doc.providerClaim.usedAt && doc.providerClaim.expiresAt > now) {
      return res.status(200).json({
        token: null,                // we don't store plaintext
        expiresAt: doc.providerClaim.expiresAt,
        alreadyExists: true,
      });
    }

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
    updateSession(res, req.user, { activeSwarm: swarmId });

    res.json({ ok: true, activeSwarm: swarmId, role: mem.role });
  } catch (err) {
    next(err);
  }
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
