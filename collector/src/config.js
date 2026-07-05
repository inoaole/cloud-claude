// Collector config + on-disk state locations. Everything lives under ~/.cloud-claude-collector/
// (LOCAL to the device, never committed): config.json (secrets: ingestToken) + state.json (watermarks).
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

export const HOME_DIR = process.env.CC_COLLECTOR_HOME || path.join(os.homedir(), '.cloud-claude-collector');
export const CONFIG_FILE = path.join(HOME_DIR, 'config.json');
export const STATE_FILE = path.join(HOME_DIR, 'state.json');

/** Load + validate config.json. Throws a clear error if misconfigured (a cron run should fail loud). */
export function loadConfig(file = CONFIG_FILE) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`collector config not found or invalid at ${file}: ${e.message}`);
  }
  const problems = [];
  if (!cfg.hubUrl) problems.push('hubUrl');
  if (!cfg.deviceId) problems.push('deviceId');
  if (!cfg.ingestToken) problems.push('ingestToken');
  if (!Array.isArray(cfg.repos)) problems.push('repos[]');
  if (problems.length) throw new Error(`collector config missing: ${problems.join(', ')}`);
  const seen = new Set();
  for (const r of cfg.repos) {
    if (!r.id || !r.path) throw new Error(`each repo needs {id, path}; got ${JSON.stringify(r)}`);
    // repo id is baked into event_id — duplicates would silently collide (dedup) across repos.
    if (seen.has(r.id)) throw new Error(`duplicate repo id: ${r.id} (ids must be unique)`);
    seen.add(r.id);
  }
  return {
    hubUrl: String(cfg.hubUrl).replace(/\/+$/, ''), // trim trailing slash
    deviceId: cfg.deviceId,
    ingestToken: cfg.ingestToken,
    intervalSec: Number(cfg.intervalSec) || 180,
    repos: cfg.repos,
  };
}
