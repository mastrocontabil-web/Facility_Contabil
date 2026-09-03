export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Não autenticado') => new HttpError(401, msg);
export const forbidden = (msg = 'Sem permissão') => new HttpError(403, msg);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg);
export const unprocessable = (msg: string, details?: unknown) => new HttpError(422, msg, details);
export const badGateway = (msg: string, details?: unknown) => new HttpError(502, msg, details);
