import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config({
  path:
    process.env.NODE_ENV === 'production'
      ? '.env.production'
      : '.env.development',
}); // ← обязательно для CLI-команд (migration:generate и т.д.)

// Для CLI используем process.env напрямую
// В runtime Nest переопределит это через TypeOrmModule.forRootAsync

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 5432,
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'password',
  database: process.env.DATABASE_NAME || 'contestdb',
  schema: process.env.DATABASE_SCHEMA || 'public',

  synchronize: false, // никогда не true в проде!
  // logging: process.env.NODE_ENV !== 'production' ? 'all' : false,
  logging: false,

  entities: ['dist/**/*.entity{.ts,.js}'], // или 'src/**/*.entity{.ts,.js}' если хочешь dev-режим
  migrations: ['dist/database/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
});
