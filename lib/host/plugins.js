/** Mount a service whose config was already validated by the root schema. */
export function configuredService(Service) {
    // Keep Cordis on its class-plugin path: it owns the instance, decorator init
    // hooks, Service.init, dependency injection, and disposal. A function wrapper
    // that only constructs the service would skip those initialization hooks.
    return class ConfiguredService extends Service {
        static Config = undefined;
    };
}
/** Keep a function plugin's dependencies while skipping duplicate validation. */
export function configuredPlugin(plugin) {
    return { name: plugin.name, inject: plugin.inject, apply: plugin.apply };
}
//# sourceMappingURL=plugins.js.map