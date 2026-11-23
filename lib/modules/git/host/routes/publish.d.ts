import type { JsonRouteSpec } from '../../../../host/routes.js';
import type { createPublishService } from '../publish.js';
export declare function createGitPublishRoutes(publish: ReturnType<typeof createPublishService>): JsonRouteSpec[];
