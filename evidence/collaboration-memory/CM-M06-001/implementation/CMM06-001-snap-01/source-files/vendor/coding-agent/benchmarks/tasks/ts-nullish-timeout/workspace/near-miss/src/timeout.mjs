export function effectiveTimeout(config, fallback) {
  return config.timeoutMs === null ? fallback : config.timeoutMs;
}
