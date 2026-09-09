import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { StorageBackend } from './StorageBackend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.join(__dirname, '../../../uploads/images');

export class LocalStorageBackend extends StorageBackend {
  constructor() {
    super();
    this.baseDir = BASE_DIR;
  }

  async put(key, buffer, contentType) {
    const filePath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async get(key) {
    const filePath = path.join(this.baseDir, key);
    try {
      const buffer = await fs.readFile(filePath);
      return { buffer, contentType: null };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key) {
    const filePath = path.join(this.baseDir, key);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async exists(key) {
    const filePath = path.join(this.baseDir, key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(key) {
    return `/uploads/images/${key}`;
  }
}
