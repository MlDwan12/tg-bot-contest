import * as fs from 'fs/promises';
import { join } from 'path';

export async function deleteContestImageByPath(
  imagePath?: string,
): Promise<void> {
  if (!imagePath) {
    return;
  }

  // ожидаем формат /uploads/contests/filename.ext
  const normalized = imagePath.trim();

  if (!normalized.startsWith('/uploads/contests/')) {
    return;
  }

  const fileName = normalized.replace('/uploads/contests/', '');

  if (!fileName) {
    return;
  }

  const absolutePath = join(process.cwd(), 'uploads', 'contests', fileName);

  try {
    await fs.unlink(absolutePath);
  } catch {
    // молча пропускаем
  }
}
