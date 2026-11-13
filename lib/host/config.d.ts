import s from '@deepseek-ai/schemastery';
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    shell: s<any, any, "defined">;
    boot: s<Schemastery.ObjectS<NoInfer<{
        animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: s<boolean, boolean, "volatile-defined">;
        allowSkip: s<boolean, boolean, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: s<boolean, boolean, "volatile-defined">;
        allowSkip: s<boolean, boolean, "volatile-defined">;
    }>>, "defined">;
    theme: s<Schemastery.ObjectS<NoInfer<{
        palette: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        palette: s<string, string, "volatile-defined">;
    }>>, "defined">;
    archived: s<any, any, "defined">;
    browser: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "defined">;
    judgement: s<Schemastery.ObjectS<NoInfer<{
        connections: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: s<string, string, "volatile-defined">;
        ledger: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        connections: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: s<string, string, "volatile-defined">;
        ledger: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "defined">;
    mobile: s<any, any, "defined">;
    skillsMcp: s<Schemastery.ObjectS<NoInfer<{
        toolFilters: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        toolFilters: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, "volatile-defined">;
    }>>, "defined">;
    notification: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        soundEnabled: s<boolean, boolean, "volatile-defined">;
        volume: s<number, number, "volatile-defined">;
        currentMode: s<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
        sound: s<string, string, "volatile-defined">;
        scope: s<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
        completedEnabled: s<boolean, boolean, "volatile-defined">;
        completedSound: s<string, string, "volatile-defined">;
        failedEnabled: s<boolean, boolean, "volatile-defined">;
        failedSound: s<string, string, "volatile-defined">;
        questionEnabled: s<boolean, boolean, "volatile-defined">;
        questionSound: s<string, string, "volatile-defined">;
        permissionEnabled: s<boolean, boolean, "volatile-defined">;
        permissionSound: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        soundEnabled: s<boolean, boolean, "volatile-defined">;
        volume: s<number, number, "volatile-defined">;
        currentMode: s<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
        sound: s<string, string, "volatile-defined">;
        scope: s<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
        completedEnabled: s<boolean, boolean, "volatile-defined">;
        completedSound: s<string, string, "volatile-defined">;
        failedEnabled: s<boolean, boolean, "volatile-defined">;
        failedSound: s<string, string, "volatile-defined">;
        questionEnabled: s<boolean, boolean, "volatile-defined">;
        questionSound: s<string, string, "volatile-defined">;
        permissionEnabled: s<boolean, boolean, "volatile-defined">;
        permissionSound: s<string, string, "volatile-defined">;
    }>>, "defined">;
    pet: s<Schemastery.ObjectS<NoInfer<{
        activePet: s<string, string, "volatile-defined">;
        petEnabled: s<boolean, boolean, "volatile-defined">;
        petSize: s<number, number, "volatile-defined">;
        bubbleWidth: s<number, number, "volatile-defined">;
        islandEnabled: s<boolean, boolean, "volatile-defined">;
        islandIdle: s<boolean, boolean, "volatile-defined">;
        islandAllDisplays: s<boolean, boolean, "volatile-defined">;
        islandWidth: s<number, number, "volatile-defined">;
        islandHeight: s<number, number, "volatile-defined">;
        electronPath: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        activePet: s<string, string, "volatile-defined">;
        petEnabled: s<boolean, boolean, "volatile-defined">;
        petSize: s<number, number, "volatile-defined">;
        bubbleWidth: s<number, number, "volatile-defined">;
        islandEnabled: s<boolean, boolean, "volatile-defined">;
        islandIdle: s<boolean, boolean, "volatile-defined">;
        islandAllDisplays: s<boolean, boolean, "volatile-defined">;
        islandWidth: s<number, number, "volatile-defined">;
        islandHeight: s<number, number, "volatile-defined">;
        electronPath: s<string, string, "volatile-defined">;
    }>>, "defined">;
    remote: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        credentialRef: s<string, string, "volatile-defined">;
        monitorOnConnect: s<boolean, boolean, "volatile-defined">;
        bridgeEnabled: s<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: s<string, string, "volatile-defined">;
        bridgePermissionPreset: s<string, string, "volatile-defined">;
        bridgeWorkspace: s<string, string, "volatile-defined">;
        bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        credentialRef: s<string, string, "volatile-defined">;
        monitorOnConnect: s<boolean, boolean, "volatile-defined">;
        bridgeEnabled: s<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: s<string, string, "volatile-defined">;
        bridgePermissionPreset: s<string, string, "volatile-defined">;
        bridgeWorkspace: s<string, string, "volatile-defined">;
        bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
    }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    shell: s<any, any, "defined">;
    boot: s<Schemastery.ObjectS<NoInfer<{
        animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: s<boolean, boolean, "volatile-defined">;
        allowSkip: s<boolean, boolean, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: s<boolean, boolean, "volatile-defined">;
        allowSkip: s<boolean, boolean, "volatile-defined">;
    }>>, "defined">;
    theme: s<Schemastery.ObjectS<NoInfer<{
        palette: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        palette: s<string, string, "volatile-defined">;
    }>>, "defined">;
    archived: s<any, any, "defined">;
    browser: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: s<boolean, boolean, "defined">;
            allowedDomains: s<string[], string[], "defined">;
            maxOutput: s<number, number, "defined">;
            idleTimeout: s<string, string, "defined">;
            profile: s<string, string, "defined">;
            executablePath: s<string, string, "defined">;
            contentBoundaries: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: s<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: s<boolean, boolean, "defined">;
            raw: s<boolean, boolean, "defined">;
            screenshot: s<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: s<number, number, "defined">;
            maxSteps: s<number, number, "defined">;
            goalThreshold: s<number, number, "defined">;
            stuckThreshold: s<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "defined">;
    judgement: s<Schemastery.ObjectS<NoInfer<{
        connections: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: s<string, string, "volatile-defined">;
        ledger: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        connections: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: s<string, string, "defined">;
            baseUrl: s<string, string, "defined">;
            model: s<string, string, "defined">;
            credentialRef: s<string, string, "defined">;
            timeoutMs: s<number, number, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: s<string, string, "defined">;
            quota: s<Schemastery.ObjectS<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: s<number, number, "defined">;
                inputTokensPerHour: s<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: s<string, string, "volatile-defined">;
        ledger: s<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: s<boolean, boolean, "defined">;
            path: s<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "defined">;
    mobile: s<any, any, "defined">;
    skillsMcp: s<Schemastery.ObjectS<NoInfer<{
        toolFilters: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        toolFilters: s<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            mode: s<string, string, "defined">;
            tools: s<string[], string[], "defined">;
        }>>, string>>, "volatile-defined">;
    }>>, "defined">;
    notification: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        soundEnabled: s<boolean, boolean, "volatile-defined">;
        volume: s<number, number, "volatile-defined">;
        currentMode: s<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
        sound: s<string, string, "volatile-defined">;
        scope: s<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
        completedEnabled: s<boolean, boolean, "volatile-defined">;
        completedSound: s<string, string, "volatile-defined">;
        failedEnabled: s<boolean, boolean, "volatile-defined">;
        failedSound: s<string, string, "volatile-defined">;
        questionEnabled: s<boolean, boolean, "volatile-defined">;
        questionSound: s<string, string, "volatile-defined">;
        permissionEnabled: s<boolean, boolean, "volatile-defined">;
        permissionSound: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        soundEnabled: s<boolean, boolean, "volatile-defined">;
        volume: s<number, number, "volatile-defined">;
        currentMode: s<"never" | "unfocused" | "always" | "hidden", "never" | "unfocused" | "always" | "hidden", "volatile-defined">;
        sound: s<string, string, "volatile-defined">;
        scope: s<"all" | "main" | "main-wait", "all" | "main" | "main-wait", "volatile-defined">;
        completedEnabled: s<boolean, boolean, "volatile-defined">;
        completedSound: s<string, string, "volatile-defined">;
        failedEnabled: s<boolean, boolean, "volatile-defined">;
        failedSound: s<string, string, "volatile-defined">;
        questionEnabled: s<boolean, boolean, "volatile-defined">;
        questionSound: s<string, string, "volatile-defined">;
        permissionEnabled: s<boolean, boolean, "volatile-defined">;
        permissionSound: s<string, string, "volatile-defined">;
    }>>, "defined">;
    pet: s<Schemastery.ObjectS<NoInfer<{
        activePet: s<string, string, "volatile-defined">;
        petEnabled: s<boolean, boolean, "volatile-defined">;
        petSize: s<number, number, "volatile-defined">;
        bubbleWidth: s<number, number, "volatile-defined">;
        islandEnabled: s<boolean, boolean, "volatile-defined">;
        islandIdle: s<boolean, boolean, "volatile-defined">;
        islandAllDisplays: s<boolean, boolean, "volatile-defined">;
        islandWidth: s<number, number, "volatile-defined">;
        islandHeight: s<number, number, "volatile-defined">;
        electronPath: s<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        activePet: s<string, string, "volatile-defined">;
        petEnabled: s<boolean, boolean, "volatile-defined">;
        petSize: s<number, number, "volatile-defined">;
        bubbleWidth: s<number, number, "volatile-defined">;
        islandEnabled: s<boolean, boolean, "volatile-defined">;
        islandIdle: s<boolean, boolean, "volatile-defined">;
        islandAllDisplays: s<boolean, boolean, "volatile-defined">;
        islandWidth: s<number, number, "volatile-defined">;
        islandHeight: s<number, number, "volatile-defined">;
        electronPath: s<string, string, "volatile-defined">;
    }>>, "defined">;
    remote: s<Schemastery.ObjectS<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        credentialRef: s<string, string, "volatile-defined">;
        monitorOnConnect: s<boolean, boolean, "volatile-defined">;
        bridgeEnabled: s<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: s<string, string, "volatile-defined">;
        bridgePermissionPreset: s<string, string, "volatile-defined">;
        bridgeWorkspace: s<string, string, "volatile-defined">;
        bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: s<boolean, boolean, "volatile-defined">;
        credentialRef: s<string, string, "volatile-defined">;
        monitorOnConnect: s<boolean, boolean, "volatile-defined">;
        bridgeEnabled: s<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: s<string, string, "volatile-defined">;
        bridgePermissionPreset: s<string, string, "volatile-defined">;
        bridgeWorkspace: s<string, string, "volatile-defined">;
        bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
    }>>, "defined">;
}>>, "plain">;
//# sourceMappingURL=config.d.ts.map