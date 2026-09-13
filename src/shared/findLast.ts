/**
 * Last element matching `predicate`, scanning from the end.
 * Avoids `[...items].reverse().find(...)` copies on hot paths.
 */
export function findLast<T>(items: readonly T[], predicate: (item: T, index: number) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (predicate(item, index)) {
      return item;
    }
  }
  return undefined;
}
