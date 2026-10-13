// One CSV file in memory (spec 055 import): ≤ 5 MB, .csv only. The content
// is parsed as text and never stored as a file.

import multer from 'multer';
import path from 'path';
import { ValidationError } from './errorHandler.js';

export const CSV_MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== '.csv') {
      callback(new ValidationError('Validation failed', [{ field: 'file', message: 'Choose a .csv file' }]));
      return;
    }
    callback(null, true);
  },
}).single('file');

/** Parses `file` into `req.file`; a missing file or one over 5 MB is a 400. */
export function csvUpload(req, res, next) {
  upload(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      next(new ValidationError('Validation failed', [{ field: 'file', message: 'The file is larger than 5 MB' }]));
      return;
    }
    if (error) {
      next(error);
      return;
    }
    if (!req.file) {
      next(new ValidationError('Validation failed', [{ field: 'file', message: 'Choose a .csv file' }]));
      return;
    }
    next();
  });
}
