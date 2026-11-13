import { readFileSync } from "node:fs";
import { Config, readBootConfig } from "./config.js";
import { createBootScene } from "./scene.js";
export const name = "toolkit-boot";
export const inject = [];
let bootAssets;
function readBootAssets() {
    if (bootAssets === undefined) {
        const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
        bootAssets = { css: read("boot.css"), html: read("boot.html"), script: read("boot.js") };
    }
    return bootAssets;
}
export function apply(ctx, config = {}) {
    ctx.on("webserver/index-inject", (table) => {
        const scene = createBootScene(readBootAssets(), readBootConfig(config));
        table.push({ kind: "style", text: scene.css }, { kind: "html", placement: "body", html: scene.html }, { kind: "script", placement: "body", text: scene.script });
    });
}
export { Config };
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map