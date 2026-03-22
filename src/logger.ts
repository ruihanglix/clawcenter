let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

export function debug(tag: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`\x1b[90m${ts}\x1b[0m \x1b[36m[DEBUG:${tag}]\x1b[0m`, ...args);
}

export function info(tag: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`\x1b[90m${ts}\x1b[0m \x1b[33m[${tag}]\x1b[0m`, ...args);
}

export function error(tag: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`\x1b[90m${ts}\x1b[0m \x1b[31m[${tag}]\x1b[0m`, ...args);
}
