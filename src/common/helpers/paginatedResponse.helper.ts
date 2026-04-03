import { Paginated } from 'src/shared/commons/response/paginated.type';

export function buildPaginatedResponse<T>(params: {
  items: T[];
  total: number;
  page: number;
  limit: number;
}): Paginated<T> {
  const { items, total, page, limit } = params;

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
