import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { ValidationError } from './errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const logoUploadsDir = path.join(__dirname, '../../uploads/logos');
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

if (!fs.existsSync(logoUploadsDir)) {
  fs.mkdirSync(logoUploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, logoUploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.has(extension) && allowedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new ValidationError('Only JPG, PNG, GIF, and WebP image files are allowed'));
  },
});

export const uploadLogo = (req, res, next) => {
  upload.single('logo')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new ValidationError('Logo must be 5 MB or smaller'));
      return;
    }
    next(error);
  });
};

export function getLogoUrl(filename) {
  return `/uploads/logos/${filename}`;
}

export async function removeLocalLogo(logoUrl) {
  if (!logoUrl?.startsWith('/uploads/logos/')) return;

  const filename = path.basename(logoUrl);
  const filePath = path.join(logoUploadsDir, filename);
  if (path.dirname(filePath) !== logoUploadsDir) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
