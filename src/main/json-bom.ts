/**
 * Editors and some Windows tools write a UTF-8 BOM. JSON.parse rejects it, which
 * would send a healthy state.json / cli-config.json down the corrupt path.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
