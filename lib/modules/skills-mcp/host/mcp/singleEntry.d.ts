export declare const SINGLE_ENTRY = "mcp";
export declare function createSingleDispatch(ctx: any): (definition: any, args: unknown, exec: any, resolve: () => any) => Promise<{
    value: any;
    content: any;
}>;
export declare function singleEntryDefinition(execute: (args: any, exec: any) => Promise<unknown>, projections: WeakMap<object, any>): {
    name: string;
    description: string;
    parameters: {
        type: string;
        required: string[];
        additionalProperties: boolean;
        properties: {
            action: {
                type: string;
                enum: string[];
            };
            query: {
                type: string;
                maxLength: number;
            };
            server: {
                type: string;
                maxLength: number;
            };
            tool: {
                type: string;
                maxLength: number;
            };
            args: {
                type: string;
            };
        };
    };
    output: {
        schema: {};
        render: (_args: unknown, value: unknown) => {
            type: string;
            text: string;
        }[];
    };
    execute: (args: any, exec: any) => Promise<unknown>;
    projectContent(exec: object, result: any): any;
};
//# sourceMappingURL=singleEntry.d.ts.map