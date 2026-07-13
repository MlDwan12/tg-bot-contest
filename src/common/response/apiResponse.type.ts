export type ApiResponse<T> = {
  success: boolean;
  status: number;
  data: T;
};
