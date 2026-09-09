import { LocalStorageBackend } from './LocalStorageBackend.js';
import { RemoteStorageBackend } from './RemoteStorageBackend.js';

let instance = null;

export function getStorageBackend() {
  if (!instance) {
    instance = process.env.BUCKET_NAME
      ? new RemoteStorageBackend()
      : new LocalStorageBackend();
  }
  return instance;
}
