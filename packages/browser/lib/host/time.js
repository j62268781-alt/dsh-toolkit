/** Wait for the same ref'ed timer used by the CLI and polling loops. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
