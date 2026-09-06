import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readPackageVersion, root, stripTagPrefix } from "./read-version.mjs";

const version = readPackageVersion();
const tag = stripTagPrefix(process.env.GITHUB_REF_NAME ?? process.argv[2] ?? "");
if (tag && tag !== version) {
  throw new Error(`tag ${process.env.GITHUB_REF_NAME ?? tag} 必须等于 package.json 的 ${version}`);
}

const properties = readFileSync(join(root, "android", "version.properties"), "utf8");
const name = /VERSION_NAME=(.+)/.exec(properties)?.[1]?.trim();
if (name !== version) {
  throw new Error(`android/version.properties 是 ${name}，和 package.json ${version} 不一致。先跑 npm run android:sync`);
}

console.log(`release version ok: ${version}`);
