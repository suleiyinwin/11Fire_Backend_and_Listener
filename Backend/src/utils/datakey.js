// Get (or create) the per-swarm 32-byte data key used for FILE encryption.
// Stored only as wrapped in the Swarm.enc subdoc.

import crypto from 'crypto';
import Swarm from '../models/Swarm.js';
import { wrapKey, unwrapKey } from './keywrap.js';

export async function getOrCreateSwarmDataKey(swarmId) {
  const swarm = await Swarm.findById(swarmId).select('enc').lean();
  if (!swarm) throw new Error('getOrCreateSwarmDataKey: swarm not found');

  if (swarm.enc?.ctB64) {
    // existing wrapped key → unwrap
    return unwrapKey(swarm.enc);
  }

  // Generate fresh 32-byte key, wrap, and save back on the swarm doc
  const key = crypto.randomBytes(32);
  const wrapped = wrapKey(key);

  await Swarm.findByIdAndUpdate(swarmId, { enc: wrapped });
  return key;
}

export async function getSwarmDataKey(swarmId) {
  const swarm = await Swarm.findById(swarmId).select('enc').lean();
  if (!swarm || !swarm.enc?.ctB64) {
    throw new Error('getSwarmDataKey: no wrapped key stored on swarm');
  }
  return unwrapKey(swarm.enc);
}
