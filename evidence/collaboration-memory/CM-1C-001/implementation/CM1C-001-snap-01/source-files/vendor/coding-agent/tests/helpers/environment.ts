export type EnvironmentOverrides = Readonly<Record<string, string | undefined>>;

export async function withEnvironment<T>(
  overrides: EnvironmentOverrides,
  action: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return await action();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
