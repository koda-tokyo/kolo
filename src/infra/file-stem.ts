// A file-name stem that is valid on every supported OS.
//
// Agent and user ids such as `agent:test:embedded` are used as per-id JSON file names; ':' and
// several other characters are refused by NTFS, so every character that is invalid on any
// supported OS maps to '_' (trailing dots and spaces are dropped too, Windows strips them).

export function safeFileStem(id: string): string {
  const cleaned = id.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned : "_";
}
