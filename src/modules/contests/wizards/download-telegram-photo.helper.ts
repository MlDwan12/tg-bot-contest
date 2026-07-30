import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  CONTEST_UPLOADS_DIR,
  MAILING_UPLOADS_DIR,
} from 'src/common/constants/storage.constants';

/**
 * Telegram при отправке фото в чат всегда переупаковывает его в JPEG,
 * поэтому расширение и mimetype можно не выяснять — они фиксированы.
 */
async function downloadTelegramPhoto(
  fileUrl: string,
  dir: string,
  filename: string,
): Promise<Express.Multer.File> {
  fs.mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Не удалось скачать файл из Telegram: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(path, buffer);

  return {
    filename,
    path,
    originalname: filename,
    mimetype: 'image/jpeg',
    size: buffer.length,
  } as Express.Multer.File;
}

/** Имя файла того же формата, что и у multer в contest-image.interceptor.ts,
 * чтобы дальнейший код (resolveContestImagePath) не знал разницы между
 * загрузкой через форму и через бота. */
export async function downloadTelegramPhotoAsContestImage(
  fileUrl: string,
): Promise<Express.Multer.File> {
  return downloadTelegramPhoto(
    fileUrl,
    CONTEST_UPLOADS_DIR,
    `contest-${Date.now()}-${randomUUID()}.jpg`,
  );
}

/** То же самое, но для рассылок — имя файла в формате users.controller.ts
 * (`mailing-<ts>.<ext>`), только расширение всегда .jpg (см. выше). */
export async function downloadTelegramPhotoAsMailingImage(
  fileUrl: string,
): Promise<Express.Multer.File> {
  return downloadTelegramPhoto(
    fileUrl,
    MAILING_UPLOADS_DIR,
    `mailing-${Date.now()}-${randomUUID()}.jpg`,
  );
}
