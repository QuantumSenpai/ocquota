export class OcquotaError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends OcquotaError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIG_INVALID", message, options);
  }
}

export class DatabaseError extends OcquotaError {
  readonly path: string;

  constructor(code: string, message: string, path: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.path = path;
  }
}

export class DatabaseBusyError extends DatabaseError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(
      "DB_BUSY",
      `The OpenCode database at ${path} is locked by another process. Nothing is wrong — retry in a moment.`,
      path,
      options,
    );
  }
}

export function friendlyMessage(error: unknown): string {
  if (error instanceof OcquotaError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
