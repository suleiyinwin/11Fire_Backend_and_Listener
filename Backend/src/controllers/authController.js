import Auth from '../models/Auth.js';
import { msalClient } from '../lib/msalClient.js';
import { issueSession, updateSession, clearSession } from '../utils/session.js';


const BASE_SCOPES = ['openid', 'profile', 'email'];

export async function startLogin(_req, res, next) {
  try {
    const url = await msalClient.getAuthCodeUrl({
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });
    res.redirect(url);
  } catch (err) { next(err); }
}

export async function callback(req, res, next) {
  try {
    const { code } = req.query; //Receives the code from Microsoft.
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });

    //exchange code for tokens and user info (idTokenClaims).
    const tokenResp = await msalClient.acquireTokenByCode({
      code,
      scopes: BASE_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    const c = tokenResp.idTokenClaims || {};
    if (c.tid !== process.env.AZURE_TENANT_ID) return res.status(403).json({ error: 'Wrong tenant' });

    const email = c.preferred_username || c.upn || null;
    const username = c.name || email || 'User';

    // Creates or updates the user document
    const user = await Auth.findOneAndUpdate(
      { 'ms.oid': c.oid, 'ms.tid': c.tid },
      {
        $setOnInsert: { username },
        $set: {
          email,
          ms: { oid: c.oid, tid: c.tid, sub: c.sub, upn: c.upn, preferredUsername: c.preferred_username, name: c.name },
        },
      },
      { upsert: true, new: true }
    );

    issueSession(res, { uid: String(user._id), ms: { oid: c.oid, tid: c.tid }, activeSwarm: user.activeSwarm || null });

    return res.redirect(process.env.POST_LOGIN_REDIRECT || '/');
  } catch (err) { next(err); }
}
