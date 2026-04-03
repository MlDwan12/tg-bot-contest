import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { extname } from 'path';
import { CONTEST_UPLOADS_DIR } from 'src/shared/commons/constants/storage.constants';

export const contestImageUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(CONTEST_UPLOADS_DIR, { recursive: true });
      cb(null, CONTEST_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `contest-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(
      file.mimetype,
    );

    if (!ok) {
      return cb(new BadRequestException('Only jpeg/png/webp allowed'), false);
    }

    cb(null, true);
  },
};
