import { Context } from "cordis";

export interface CapabilityPlugin { name: string; services: Record<string, unknown>; dispose?: () => void }
export function createPluginHost(plugins: CapabilityPlugin[]) {
  const context = new Context();
  const services = new Map<string, unknown>();
  for (const plugin of plugins) {
    context.plugin((ctx: Context) => {
      for (const [name, implementation] of Object.entries(plugin.services)) {
        if (services.has(name)) throw new Error(`能力重复注册：${name}`);
        services.set(name, implementation);
      }
      ctx.effect(() => () => {
        for (const name of Object.keys(plugin.services)) services.delete(name);
        plugin.dispose?.();
      });
    });
  }
  return {
    get<T>(name: string): T {
      if (!services.has(name)) throw new Error(`能力未注册：${name}`);
      return services.get(name) as T;
    },
    context
  };
}
