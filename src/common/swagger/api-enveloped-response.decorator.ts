import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

interface EnvelopeOptions {
  status?: number;
  description?: string;
  nullable?: boolean;
}

// @nestjs/swagger не реэкспортирует SchemaObject из корня пакета (только из
// внутреннего interfaces/open-api-spec.interface) — описываем сами тот
// минимум, который реально используется в этом файле и в вызовах.
export interface SwaggerSchema {
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  example?: unknown;
  $ref?: string;
  items?: SwaggerSchema;
  properties?: Record<string, SwaggerSchema>;
  allOf?: SwaggerSchema[];
  [key: string]: unknown;
}

// Глобальный ResponseInterceptor (src/common/interceptors/response.interceptor.ts)
// оборачивает КАЖДЫЙ HTTP-ответ в { success, status, data } — реальное тело
// ответа это не сам DTO, а конверт вокруг него. Обычный @ApiResponse({type})
// документировал бы неверную форму (фронт решил бы, что поля DTO лежат на
// верхнем уровне). Эти хелперы документируют конверт как он есть на самом деле.
export function ApiEnvelopedResponse<TModel extends Type<unknown>>(
  model: TModel | [TModel],
  options: EnvelopeOptions = {},
) {
  const isArray = Array.isArray(model);
  const item = isArray ? model[0] : model;
  const status = options.status ?? 200;

  const dataSchema: SwaggerSchema = isArray
    ? { type: 'array', items: { $ref: getSchemaPath(item) } }
    : { $ref: getSchemaPath(item), nullable: options.nullable };

  return applyDecorators(
    ApiExtraModels(item),
    ApiResponse({
      status,
      description: options.description,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          status: { type: 'number', example: status },
          data: dataSchema,
        },
      },
    }),
  );
}

// Вариант без класса-модели — для ad-hoc форм ответа ({ message: string },
// { jobId, enqueuedCount } и т.п.), под которые заводить отдельный DTO смысла
// не имеет.
export function ApiEnvelopedResponseRaw(
  dataSchema: SwaggerSchema,
  options: EnvelopeOptions = {},
) {
  const status = options.status ?? 200;

  return ApiResponse({
    status,
    description: options.description,
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        status: { type: 'number', example: status },
        data: dataSchema,
      },
    },
  });
}

// Форма Paginated<T> (src/common/response/paginated.type.ts) — тоже плоский
// `type`, а не класс, плагину swagger нечего интроспектировать напрямую.
export function ApiEnvelopedPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeOptions = {},
) {
  const status = options.status ?? 200;

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description: options.description,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          status: { type: 'number', example: status },
          data: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
              },
              total: { type: 'number', example: 42 },
              page: { type: 'number', example: 1 },
              limit: { type: 'number', example: 10 },
              totalPages: { type: 'number', example: 5 },
              hasNextPage: { type: 'boolean', example: true },
              hasPrevPage: { type: 'boolean', example: false },
            },
          },
        },
      },
    }),
  );
}
