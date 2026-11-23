import type { GitSettings } from './config.js';
/** 生成提示词段文本；返回空串表示「一句话都不用说」，调用方据此不注册该段。 */
export declare function gitPromptText(settings: GitSettings): string;
