/** Wait for the same ref'ed timer used by the CLI and polling loops. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
