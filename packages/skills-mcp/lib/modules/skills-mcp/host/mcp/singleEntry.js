import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
export const SINGLE_ENTRY = 'mcp';
const pipelinePath = '@deepseek-ai/dsh-tools/pipeline';
// Older Hosts don't export the shared policy pipeline. Never fall back to invoking
// a tool body directly: that would bypass the target's approvals and guards.
export function createSingleDispatch(ctx) {
    let url;
    try {
        // A linked plugin can resolve against its development node_modules instead of
        // the running Host. Prefer the Host's resolver so policy sentinels keep identity.
        const home = process.env.DSH_INSTALL_DIR;
        url = home ? pathToFileURL(createRequire(`${home}/package.json`).resolve(pipelinePath)).href : import.meta.resolve(pipelinePath);
    }
    catch {
        return undefined;
    }
    const pipeline = () => import(url);
    return async (definition, args, exec, resolve) => {
        const { ToolExecutionPipeline } = await pipeline();
        exec.signal.throwIfAborted();
        const runner = new ToolExecutionPipeline(ctx, {
            get: (name, agent) => name === definition.name && agent === exec.agent ? resolve() : undefined,
        });
        const prepared = await runner.prepare({
            name: definition.name, arguments: args, agent: exec.agent, signal: exec.signal,
            callId: randomUUID(), rootCallId: exec.rootCallId, parent: exec.token, toolSet: exec.toolSet,
        });
        const outcome = prepared.kind === 'dispatch' ? await runner.dispatch(prepared.exec) : prepared;
        const result = await runner.complete(prepared.exec, outcome);
        if (result.isError)
            throw new Error(result.error?.message ?? 'MCP tool call failed');
        for (const context of result.additionalContexts ?? [])
            exec.deferContext(context);
        if (result.concludesTurn)
            exec.concludeTurn();
        return { value: result.value, content: result.content };
    };
}
export function singleEntryDefinition(execute, projections) {
    return {
        name: SINGLE_ENTRY,
        description: 'Discover and call lazily loaded MCP tools. Use search with optional query and server; use describe with server and tool for the input schema; use call with the same server and tool and an args object.',
        parameters: {
            type: 'object', required: ['action'], additionalProperties: false,
            properties: {
                action: { type: 'string', enum: ['search', 'describe', 'call'] },
                query: { type: 'string', maxLength: 200 },
                server: { type: 'string', maxLength: 32 },
                tool: { type: 'string', maxLength: 64 },
                args: { type: 'object' },
            },
        },
        output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute,
        projectContent(exec, result) {
            const projection = projections.get(exec);
            projections.delete(exec);
            return !result.isError && projection && isDeepStrictEqual(result.value, projection.value) ? projection.content : undefined;
        },
    };
}
//# sourceMappingURL=singleEntry.js.map