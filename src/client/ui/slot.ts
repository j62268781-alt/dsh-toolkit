/**
 * Mount one component on a host slot and return the teardown.
 *
 * `slots.register` only answers for slots the shell has already published, and
 * publishing is asynchronous: every call site needs the
 * `slots.inject(name, () => slots.register(...))` pair so a late slot still gets
 * the component. Six modules wrote that pair by hand, in two different orders and
 * with three different teardown shapes; the pair is one line here.
 */
export interface SlotDescriptor {
  name: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
  [key: string]: any
}

export function installSlot(ctx: any, descriptor: SlotDescriptor, Component: unknown): unknown {
  return ctx.slots.inject(descriptor.name, () => ctx.slots.register(descriptor, Component))
}
