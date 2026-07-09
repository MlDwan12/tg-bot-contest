import { createHmac, randomBytes } from 'crypto';

/**
 * Provably-fair розыгрыш: детерминированный Fisher-Yates, управляемый seed.
 * Тот же seed + тот же (канонический) порядок входа → тот же результат, поэтому
 * любой может пересчитать победителей из сохранённого seed и пула участников.
 */

/** Версия алгоритма — сохраняется в аудит, чтобы пересчёт был воспроизводим. */
export const DRAW_ALGORITHM = 'fisher-yates-hmac-sha256-v1';

/** 256-битный крипто-случайный seed в hex (заменяет небезопасный Math.random). */
export function generateSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Детерминированное несмещённое целое из [0, maxExclusive) по seed и counter.
 * Поток байт берём из HMAC-SHA256(seed, "counter:attempt"); rejection sampling
 * отсекает хвост, который дал бы modulo-смещение (честность важнее для денег).
 */
function seededRandomInt(
  seed: string,
  counter: number,
  maxExclusive: number,
): number {
  if (maxExclusive <= 1) return 0;

  const bytesNeeded = Math.max(1, Math.ceil(Math.log2(maxExclusive) / 8));
  const space = 2 ** (bytesNeeded * 8);
  const limit = space - (space % maxExclusive); // наибольшее кратное maxExclusive

  for (let attempt = 0; ; attempt++) {
    const digest = createHmac('sha256', seed)
      .update(`${counter}:${attempt}`)
      .digest();

    let value = 0;
    for (let i = 0; i < bytesNeeded; i++) {
      value = value * 256 + digest[i];
    }

    if (value < limit) {
      return value % maxExclusive;
    }
    // value попал в «смещающий» хвост — пробуем следующий attempt (детерминированно).
  }
}

/**
 * Детерминированный Fisher-Yates. НЕ мутирует вход. Для воспроизводимости вход
 * должен быть в КАНОНИЧЕСКОМ порядке (напр. отсортирован по userId) — тогда
 * порядок строк в БД не влияет на результат.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const array = [...items];
  let counter = 0;

  for (let i = array.length - 1; i > 0; i--) {
    const j = seededRandomInt(seed, counter++, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}
