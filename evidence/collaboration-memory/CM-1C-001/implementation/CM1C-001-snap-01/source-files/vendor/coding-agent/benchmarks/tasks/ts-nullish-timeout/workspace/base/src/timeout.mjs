export function effectiveTimeout(config, fallback) {
  return config.timeoutMs || fallback;
}
