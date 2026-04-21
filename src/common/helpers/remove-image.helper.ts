import * as fs from 'fs/promises';
import { Logger } from '@nestjs/common';

export async function deleteUploadedContestImage(
  image?: Express.Multer.File,
  logger?: Logger,
): Promise<void> {
  if (!image?.path) {
    return;
  }

  try {
    await fs.unlink(image.path);
  } catch (error) {
    logger?.warn(
      `Не удалось удалить загруженный файл "${image.path}" после ошибки`,
    );
  }
}
