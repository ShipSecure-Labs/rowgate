export function parsePossibleTableAlias<T extends string>(
  str: T,
): { runtimeTable: T; table: T } {
  const parts = str.split(" ");
  return {
    table: parts[0].trim() as T,
    runtimeTable: parts[parts.length - 1]?.trim() as T,
  } as const;
}
