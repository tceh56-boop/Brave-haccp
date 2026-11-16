/** Ошибка предметной области: код для клиента, понятный текст и HTTP-статус. */
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) => new AppError('VALIDATION', message, 400, details),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 'Нужно войти в систему.', 401),
  forbidden: (message = 'Недостаточно прав для этого действия.') => new AppError('FORBIDDEN', message, 403),
  notFound: (message = 'Не найдено.') => new AppError('NOT_FOUND', message, 404),
  conflict: (message: string) => new AppError('CONFLICT', message, 409),
  tooMany: (message: string) => new AppError('RATE_LIMITED', message, 429),
};
