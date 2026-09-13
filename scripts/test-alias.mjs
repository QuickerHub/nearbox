/**
 * Resolve `@shared/*` and extensionless relative `.ts` imports for `node --test`.
 * Production code uses electron-vite path aliases; unit tests do not.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

register(
  `data:text/javascript,${encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
const root = ${JSON.stringify(root)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@shared/")) {
    const rest = specifier.slice("@shared/".length);
    const url = "file://" + root + "/src/shared/" + rest + (rest.endsWith(".ts") ? "" : ".ts");
    return { url, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier) && context.parentURL) {
    try {
      const parent = dirname(fileURLToPath(context.parentURL));
      const candidate = join(parent, specifier + ".ts");
      if (existsSync(candidate)) {
        return { url: "file://" + candidate, shortCircuit: true };
      }
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}
`)}`,
  pathToFileURL(`${root}/`),
);
