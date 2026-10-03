// Credentials for each store the developer signed in to, in
// ~/.config/jump/credentials.json (mode 0600). JUMP_CONFIG_DIR overrides
// the folder (tests, CI).

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function configDir() {
  return process.env.JUMP_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jump');
}

const file = () => join(configDir(), 'credentials.json');

export async function readCredentials() {
  try {
    return JSON.parse(await readFile(file(), 'utf8'));
  } catch {
    return { stores: {}, current: null };
  }
}

export async function writeCredentials(credentials) {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(file(), `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(file(), 0o600); // an existing file keeps its old mode otherwise
}

/** The signed-in store: --store, else the theme folder's store, else the last login. */
export async function storeCredentials(store) {
  const credentials = await readCredentials();
  const key = store || credentials.current;
  const entry = key ? credentials.stores[key] : null;
  if (!entry) throw new Error(key ? `Not signed in to ${key}. Run \`jump login --store ${key}\`.` : 'Not signed in. Run `jump login --store <store>`.');
  return { key, ...entry };
}
