// src/styles/app.scss를 public/assets/app.css로 컴파일한다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as sass from "sass";

const out = "public/assets/app.css";
const { css } = sass.compile("src/styles/app.scss", {
  loadPaths: ["node_modules", "node_modules/.pnpm/node_modules"],
  style: "compressed",
  quietDeps: true,
  silenceDeprecations: ["import", "global-builtin", "if-function"],
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, css);
console.log(`${out}: ${(css.length / 1024).toFixed(1)} KiB`);
