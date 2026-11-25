import { pluginApiPath } from '../../../host/paths.js';
const API_PREFIX = pluginApiPath('worktrees');
export const WORKTREE_CONFIG_PATH = `${API_PREFIX}/config`;
export const MANAGED_WORKTREES_PATH = `${API_PREFIX}/managed`;
export const MANAGED_WORKTREE_CHECK_PATH = `${MANAGED_WORKTREES_PATH}/check`;
export const MANAGED_WORKTREE_SNAPSHOTS_PATH = `${MANAGED_WORKTREES_PATH}/snapshots`;
