/** The three texts the preview page and the real boot share. */
export interface BootAssets {
    css: string;
    html: string;
    script: string;
}
export interface BootScene {
    html: string;
    css: string;
    script?: string;
}
export declare function createBootScene(assets: BootAssets, config: any, { preview }?: {
    preview?: boolean;
}): BootScene;
export declare function createPreviewDocument(assets: BootAssets, config: any): string;
export declare function renderBootScript(assets: BootAssets): string;
//# sourceMappingURL=scene.d.ts.map