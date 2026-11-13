import { Config } from './host/config.js';
export { Config };
export declare const name = "dsh-toolkit";
export declare const inject: string[];
export declare function apply(ctx: any, config: any): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        shell: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        boot: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
            theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
            showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
            theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
            showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        }>>, "defined">;
        theme: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            palette: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            palette: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        archived: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        browser: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
            tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, "volatile-defined">;
            judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
            tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, "volatile-defined">;
            judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, "defined">;
        judgement: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, "defined">;
        mobile: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        skillsMcp: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            toolFilters: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            toolFilters: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, "volatile-defined">;
        }>>, "defined">;
        notification: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            soundEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            volume: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            currentMode: import("@deepseek-ai/schemastery").default<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
            sound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            scope: import("@deepseek-ai/schemastery").default<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
            completedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            completedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            failedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            failedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            questionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            questionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            permissionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            permissionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            soundEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            volume: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            currentMode: import("@deepseek-ai/schemastery").default<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
            sound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            scope: import("@deepseek-ai/schemastery").default<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
            completedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            completedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            failedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            failedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            questionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            questionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            permissionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            permissionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        pet: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            activePet: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            petEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            petSize: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bubbleWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandIdle: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandAllDisplays: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandHeight: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            electronPath: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            activePet: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            petEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            petSize: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bubbleWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandIdle: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandAllDisplays: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandHeight: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            electronPath: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        remote: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
            bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
            bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
            bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
            bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        }>>, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        shell: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        boot: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
            theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
            showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
            theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
            showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        }>>, "defined">;
        theme: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            palette: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            palette: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        archived: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        browser: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
            tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, "volatile-defined">;
            judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
                maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
            tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            }>>>, "volatile-defined">;
            limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>>, "volatile-defined">;
            judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, "defined">;
        judgement: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                    inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                }>>, "defined">;
            }>>, string>>, "volatile-defined">;
            defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
                enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
                path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            }>>>, "volatile-defined">;
        }>>, "defined">;
        mobile: import("@deepseek-ai/schemastery").default<any, any, "defined">;
        skillsMcp: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            toolFilters: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            toolFilters: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                mode: import("@deepseek-ai/schemastery").default<string, string, "defined">;
                tools: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            }>>, string>>, "volatile-defined">;
        }>>, "defined">;
        notification: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            soundEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            volume: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            currentMode: import("@deepseek-ai/schemastery").default<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
            sound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            scope: import("@deepseek-ai/schemastery").default<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
            completedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            completedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            failedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            failedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            questionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            questionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            permissionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            permissionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            soundEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            volume: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            currentMode: import("@deepseek-ai/schemastery").default<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
            sound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            scope: import("@deepseek-ai/schemastery").default<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
            completedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            completedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            failedEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            failedSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            questionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            questionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            permissionEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            permissionSound: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        pet: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            activePet: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            petEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            petSize: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bubbleWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandIdle: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandAllDisplays: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandHeight: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            electronPath: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            activePet: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            petEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            petSize: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bubbleWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandIdle: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandAllDisplays: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            islandWidth: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            islandHeight: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            electronPath: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        }>>, "defined">;
        remote: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
            bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
            bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
            bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
            bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
            bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        }>>, "defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map