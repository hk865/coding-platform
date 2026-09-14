export function isAuthorized(header, expectedToken) {
  return typeof header === "string" && header.startsWith(`Bearer ${expectedToken}`);
}
