/**
 * Typed errors carrying user-facing messages. The CLI prints `message` for any
 * OcquotaError and exits 1; anything else is a bug and prints a stack trace.
 */

export class OcquotaError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Bad or unreadable configuration (file, env vars, CLI values). */
export class ConfigError extends OcquotaError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIG_INVALID", message, options);
  }
}

/** Anything that went wrong talking to the SQLite database. */
export class DatabaseError extends OcquotaError {
  readonly path: string;

  constructor(code: string, message: string, path: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.path = path;
  }
}

/** Another process held the write lock past our busy timeout. Safe to retry. */
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

/** Best-effort user-facing text for any thrown value. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof OcquotaError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
