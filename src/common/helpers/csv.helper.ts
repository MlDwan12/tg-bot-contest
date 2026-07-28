/**
 * Сборка CSV. Экранирование вынесено сюда, потому что в выгрузку попадают
 * ники и имена — то есть данные, которые пишет пользователь, а не мы.
 */

/**
 * Разделитель — точка с запятой, а не запятая.
 *
 * Excel в русской локали разбирает CSV по разделителю списка из настроек ОС, а
 * там `;`. С запятой оператор получит файл, где все колонки склеены в одну.
 */
export const CSV_DELIMITER = ';';

/** Excel без BOM читает UTF-8 как cp1251 и показывает кириллицу кракозябрами. */
export const CSV_BOM = '﻿';

const NEEDS_QUOTING = /["\n\r;,]/;

/**
 * Excel и LibreOffice трактуют ячейку, начинающуюся с этих символов, как
 * формулу. Ник вида `=1+1` или `@user` превратится в вычисление, а
 * `=HYPERLINK(...)` — в кликабельную ссылку в чужой таблице. Классический
 * CSV injection: гасим ведущей кавычкой.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Число целиком — не формула, даже если начинается с минуса. Без этого
 * исключения апостроф лип бы к каждому telegramId канала (они отрицательные),
 * и в ячейке оставался бы мусор вида `'-1002949180383`.
 */
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);

  if (
    text.length &&
    FORMULA_PREFIXES.includes(text[0]) &&
    !PLAIN_NUMBER.test(text)
  ) {
    text = `'${text}`;
  }

  if (NEEDS_QUOTING.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Строка CSV с переводом строки CRLF — так требует RFC 4180 и любит Excel. */
export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvValue).join(CSV_DELIMITER) + '\r\n';
}
