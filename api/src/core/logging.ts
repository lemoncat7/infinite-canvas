/** Runtime logging is injected by composition; services do not import HTTP. */
export type ApplicationLogger = {
  info(value: unknown, message?: string): void;
  warn(value: unknown, message?: string): void;
  error(value: unknown, message?: string): void;
};

export let logger: ApplicationLogger = console;
export function configureLogger(value: ApplicationLogger) {
  logger = value;
}
