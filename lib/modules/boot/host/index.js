import { readFileSync } from "node:fs";

export const name = "toolkit-boot";
export const inject = [];

let bootAssets;

function readBootAssets() {
  if (bootAssets === undefined) {
    const read = (file) =>
      readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    bootAssets = {
      css: read("boot.css"),
      html: read("boot.html"),
      script: read("boot.js"),
    };
  }
  return bootAssets;
}

// Inject before the client bundle mounts; no session service is required.
export function apply(ctx) {
  ctx.on("webserver/index-inject", (table) => {
    const { css, html, script } = readBootAssets();
    table.push(
      { kind: "style", text: css },
      { kind: "html", placement: "body", html },
      { kind: "script", placement: "body", text: script },
    );
  });
}

export default { name, inject, apply };
