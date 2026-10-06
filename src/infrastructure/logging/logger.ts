export interface Logger {
  info(message: string, fields?: Record<string, string | number | boolean>): void;
  warn(message: string, fields?: Record<string, string | number | boolean>): void;
  error(message: string, fields?: Record<string, string | number | boolean>): void;
}
function write(
  level: string,
  message: string,
  fields: Record<string, string | number | boolean> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`,
  );
}
export const logger: Logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
