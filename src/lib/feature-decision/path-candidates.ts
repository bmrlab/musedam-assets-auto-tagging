/** Only explicit positive folder inclusion rules opt a logo into metadata-only matching. */
export function allowsLogoFolderMatch(notes: string | null | undefined): boolean {
  if (
    !notes ||
    /(?:不|勿|禁止|忽略)[^。；;\n]{0,16}(?:文件夹|文件路径)|(?:do not|never|ignore)[^.;\n]{0,30}(?:folder|path)/i.test(
      notes,
    )
  )
    return false;
  return /(?:文件夹(?:名称|名|路径)?|文件路径)(?:中)?(?:包含|含有)|(?:folder(?: name| path)?|file path)[^.;\n]{0,24}(?:contains?|includes?)/i.test(
    notes,
  );
}

/** Bilingual catalog names supply aliases; never treat arbitrary description prose as commands. */
export function logoFolderAlias(name: string, folderPath: string): string | null {
  const aliases = name
    .replace(/\s*logo\s*(?:[（(]\d+[)）])?\s*$/i, "")
    .split(/[\/／|]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = /^[\x00-\x7F]+$/.test(alias)
      ? `(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`
      : escaped;
    if (new RegExp(pattern, "i").test(folderPath)) return alias;
  }
  return null;
}
