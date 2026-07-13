import { join } from 'path';

export const UPLOADS_DIR = join(process.cwd(), 'uploads');
export const CONTEST_UPLOADS_DIR = join(UPLOADS_DIR, 'contests');
export const MAILING_UPLOADS_DIR = join(UPLOADS_DIR, 'mailings');
