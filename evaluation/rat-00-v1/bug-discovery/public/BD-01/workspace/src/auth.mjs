export function isAuthorized(header, expectedToken) {
  return typeof header === "string" && header.includes(expectedToken);
}
