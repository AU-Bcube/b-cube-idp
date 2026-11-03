// src/styles/app.scss를 public/assets/app.css로 컴파일하고, 화면에 쓰는 로고와 파비콘, 오픈그래프 이미지를 public/assets로 복사한다.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
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
for (const lang of ["ko", "en"]) {
  for (const logo of [`b-cube-idp-${lang}-logo.png`, `b-cube-idp-${lang}-dark-logo.png`]) {
    copyFileSync(`assets/${logo}`, `public/assets/${logo}`);
  }
}
for (const file of ["b-cube-logo.png", "b-cube-idp-ko-og.png"]) {
  copyFileSync(`assets/${file}`, `public/assets/${file}`);
}
console.log(`${out}:${(css.length / 1024).toFixed(1)} KiB`);
