/** Cordis 认的插件三件套；多出来的键会被当成配置项校验，所以只转发这三个。 */
export interface PluginShape {
  name?: string
  inject?: unknown
  apply?: unknown
}

/**
 * 一个「已经过根 schema 校验」服务的类形状。
 *
 * 之前返回 `any`，于是 `ctx.plugin(configuredService(Foo))` 之后所有对 `ctx.foo` 的访问
 * 都丢类型；这里把实例类型保留下来，至少构造参数与成员是可见的。
 */
export interface ConfiguredServiceClass<T extends new (...args: any[]) => object> {
  new (...args: ConstructorParameters<T>): InstanceType<T>
  readonly Config: unknown
}

/** Mount a service whose config was already validated by the root schema. */
export function configuredService<T extends new (...args: any[]) => object>(Service: T): ConfiguredServiceClass<T> {
  // Keep Cordis on its class-plugin path: it owns the instance, decorator init
  // hooks, Service.init, dependency injection, and disposal. A function wrapper
  // that only constructs the service would skip those initialization hooks.
  const wrapped = class ConfiguredService extends Service {
    static Config: unknown = undefined
  }
  return wrapped as unknown as ConfiguredServiceClass<T>
}

/** Keep a function plugin's dependencies while skipping duplicate validation. */
export function configuredPlugin<P extends PluginShape>(plugin: P): P {
  return { name: plugin.name, inject: plugin.inject, apply: plugin.apply } as P
}
