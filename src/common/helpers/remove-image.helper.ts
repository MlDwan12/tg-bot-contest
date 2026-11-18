import * as fs from 'fs/promises';

/** Удаляет только что загруженные файлы (multer), если запрос не удался. */
export async function deleteUploadedContestImage(
  ...files: (Express.Multer.File | undefined)[]
): Promise<void> {
  for (const file of files) {
    if (!file?.path) continue;
    try {
      await fs.unlink(file.path);
    } catch {
      // файла уже нет — не страшно
    }
  }
}
