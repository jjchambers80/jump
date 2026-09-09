/**
 * Abstract storage backend for content-addressed file storage.
 * Implementations: LocalStorageBackend (dev), RemoteStorageBackend (prod).
 */
export class StorageBackend {
  /**
   * Store bytes at the given key.
   * @param {string} key - Object key (e.g. "images/original/<hash>.jpg")
   * @param {Buffer} buffer - File bytes
   * @param {string} contentType - MIME type
   */
  async put(key, buffer, contentType) {
    throw new Error('StorageBackend.put() not implemented');
  }

  /**
   * Retrieve bytes and metadata for a key.
   * @param {string} key
   * @returns {Promise<{buffer: Buffer, contentType: string} | null>}
   */
  async get(key) {
    throw new Error('StorageBackend.get() not implemented');
  }

  /**
   * Delete an object by key.
   * @param {string} key
   */
  async delete(key) {
    throw new Error('StorageBackend.delete() not implemented');
  }

  /**
   * Check if an object exists at the given key.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    throw new Error('StorageBackend.exists() not implemented');
  }

  /**
   * Get a publicly accessible URL for the key.
   * @param {string} key
   * @returns {string}
   */
  getPublicUrl(key) {
    throw new Error('StorageBackend.getPublicUrl() not implemented');
  }
}
