import { GIT_PUBLISH_REASON } from './constants.js';
import { type GitRunner } from './repository.js';
export type PublishAction = 'commit' | 'push';
export interface PublishRequest {
    readonly cwd: string;
    readonly action: PublishAction;
}
export interface PublishConfirmation extends PublishRequest {
    readonly token: string;
    readonly message?: string;
}
interface PublishPreview {
    readonly action: PublishAction;
    readonly branch: string;
    readonly head: string | null;
    readonly stagedPaths: readonly string[];
    readonly destination: {
        remote: string;
        ref: string;
        url: string;
    } | null;
    readonly ahead: number | null;
    readonly behind: number | null;
}
export interface PublishFailure {
    readonly ok: false;
    readonly reason: keyof typeof GIT_PUBLISH_REASON;
    readonly code: number;
    readonly detail: string;
}
export type PublishPreviewResult = ({
    readonly ok: true;
    readonly token: string;
} & PublishPreview) | PublishFailure;
export type PublishActionResult = {
    readonly ok: true;
    readonly action: PublishAction;
} | PublishFailure;
export declare function createPublishService(run?: GitRunner, pushRun?: GitRunner): {
    preview(request: PublishRequest): Promise<PublishPreviewResult>;
    confirm(request: PublishConfirmation): Promise<PublishActionResult>;
};
export {};
