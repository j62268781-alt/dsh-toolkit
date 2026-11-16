/**
 * 面板与宿主共用的规则/默认值：直接取 host 的 `constants.ts`（纯函数、无 Node 依赖），
 * 这里不复制第二份正则。
 */
export {
  DEFAULT_ALWAYS_FORCE_PUSH,
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_COMMIT_INSTRUCTIONS,
  GIT_BRANCHES_PATH,
  GIT_CHECKOUT_PATH,
  GIT_CREATE_BRANCH_PATH,
  MAX_BRANCH_NAME_LENGTH,
  MAX_BRANCH_PREFIX_LENGTH,
  MAX_COMMIT_INSTRUCTIONS_LENGTH,
  isBranchName,
  isBranchPrefix,
  normalizeBranchPrefix,
  normalizeCommitInstructions,
} from "../host/constants.js";

/** Qoder 的提交说明是「停手 1.2 秒就自动保存」；照抄这个节奏，别让每次敲键都重启宿主插件。 */
export const COMMIT_INSTRUCTIONS_SAVE_DELAY_MS = 1200;

/** 设置页顺序：钩子（23）之后。DSH 宿主自己的「常规」在最前面。 */
export const SECTION_ORDER = 24;
