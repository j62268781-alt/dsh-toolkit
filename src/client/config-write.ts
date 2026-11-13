/** Older Hosts resolve undefined on success; only an explicit false is a rejection. */
export async function acceptConfigWrite(write: () => unknown, field: string): Promise<unknown> {
  const accepted = await write()
  if (accepted === false) throw new Error(`宿主拒绝了这次写入（${field}）：配置可能未通过校验，或当前文档不可写`)
  return accepted
}
