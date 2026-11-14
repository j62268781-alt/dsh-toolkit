/** client 侧只转出纯常量：事件表、路由、上限；实现一律留在 host。 */
export {
  HOOK_EVENTS,
  HOOKS_REFRESH_PATH,
  HOOKS_SNAPSHOT_PATH,
  HOOKS_TEST_PATH,
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_HOOKS_PER_EVENT,
} from "../host/constants.js";
export type { HookEventDefinition, HookMatcherTarget } from "../host/constants.js";
