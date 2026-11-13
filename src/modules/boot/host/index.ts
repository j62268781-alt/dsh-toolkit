import { readFileSync } from "node:fs";
import type { BootAssets } from "./scene.js";
import { Config, readBootConfig } from "./config.js";
import { createBootScene } from "./scene.js";

export const name = "toolkit-boot";
export const inject: string[] = [];

let bootAssets: BootAssets | undefined;

function readBootAssets(): BootAssets {
  if (bootAssets === undefined) {
    const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    bootAssets = { css: read("boot.css"), html: read("boot.html"), script: read("boot.js") };
  }
  return bootAssets;
}

export function apply(ctx: any, config: any = {}): void {
  ctx.on("webserver/index-inject", (table: any[]) => {
    const scene = createBootScene(readBootAssets(), readBootConfig(config));
    table.push(
      { kind: "style", text: scene.css },
      { kind: "html", placement: "body", html: scene.html },
      { kind: "script", placement: "body", text: scene.script },
    );
  });
}

export { Config };
export default { name, inject, Config, apply };
