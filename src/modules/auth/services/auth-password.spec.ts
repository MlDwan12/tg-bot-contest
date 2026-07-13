import * as bcrypt from 'bcryptjs';

/**
 * Юнит: консолидация хеширования паролей на bcryptjs (Фаза 5).
 * Правило (🟢): существующие хеши проходят проверку через bcryptjs — переход
 * никого не разлогинит; hash→compare round-trip корректен.
 */
describe('пароли: консолидация на bcryptjs (кросс-совместимость)', () => {
  const password = 'S3cr3t-Admin-Pw!';

  // Хеш ЭТОГО пароля, созданный НАТИВНЫМ bcrypt (эмулирует хеш из БД,
  // если он был записан нативной библиотекой). Проверка соли встроена в хеш,
  // поэтому результат детерминирован.
  const nativeHash =
    '$2b$10$Bh0.pfal.EPVjrv5Zt4HhuBjMKizJvLiLPPEkllYQ3qNU1HObmRDy';

  it('bcryptjs верифицирует нативный bcrypt-хеш (не разлогинит существующих)', async () => {
    expect(await bcrypt.compare(password, nativeHash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', nativeHash)).toBe(false);
  });

  it('round-trip: hash → compare', async () => {
    const hash = await bcrypt.hash(password, 10);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', hash)).toBe(false);
  });
});
