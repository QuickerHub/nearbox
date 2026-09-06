import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPackageVersion, root, versionCodeFromName } from "./read-version.mjs";

const version = readPackageVersion();
const code = versionCodeFromName(version);
const target = join(root, "android", "version.properties");
writeFileSync(target, `VERSION_NAME=${version}\nVERSION_CODE=${code}\n`, "utf8");
console.log(`synced android ${version} (${code})`);
