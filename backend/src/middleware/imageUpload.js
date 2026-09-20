import multer from 'multer';
import { ValidationError } from './errorHandler.js';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const storage = multer.memoryStorage();

function createImageUpload(maxSizeMb = 5, fieldName = 'logo') {
  const upload = multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (allowedMimeTypes.has(file.mimetype)) {
        callback(null, true);
        return;
      }
      callback(new ValidationError('Only JPG, PNG, GIF, and WebP image files are allowed'));
    },
  });

  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new ValidationError(`Image must be ${maxSizeMb} MB or smaller`));
        return;
      }
      next(error);
    });
  };
}

export const uploadImage = createImageUpload(5);
// Spec 030: account photo, multipart field `avatar`
export const uploadAvatar = createImageUpload(5, 'avatar');
