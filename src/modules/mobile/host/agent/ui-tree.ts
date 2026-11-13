export async function dumpUiElements(
  client: any,
  deviceId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<any[]> {
  signal?.throwIfAborted();
  const data = await client.runJson(["dump", "ui", "--device", deviceId, "--format", "json"], signal ? { signal } : undefined);
  signal?.throwIfAborted();
  const roots: any[] = Array.isArray(data) ? data : (data?.elements ?? []);

  const flat: any[] = [];
  const visit = (node: any): void => {
    if (node === null || typeof node !== "object") return;
    const { children, ...rest } = node;
    flat.push(rest);
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
  };
  for (const root of roots) visit(root);
  return flat;
}

export function centerOf(rect: any): { x: number; y: number } {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}
