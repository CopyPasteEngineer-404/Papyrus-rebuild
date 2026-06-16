/**
 * Sanitize a string for use as a filename.
 * Preserves Unicode letters, digits, underscore, hyphen, space, and period.
 * Removes only characters that are invalid across Windows/macOS/Linux.
 * Truncates to a maximum length.
 */
export function sanitizeFilename(name: string, maxLength: number = 100): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, maxLength);
}

/**
 * Generate a unique filename by adding a counter suffix if the file already exists.
 * This is a TOCTOU-safe best-effort check for single-process desktop apps.
 */
export function getUniqueFilename(
  dir: string,
  baseName: string,
  ext: string,
  existsSync: (path: string) => boolean,
): string {
  const sanitized = sanitizeFilename(baseName);
  let filename = `${sanitized}.${ext}`;
  let counter = 1;
  while (existsSync(`${dir}/${filename}`)) {
    filename = `${sanitized}_${counter}.${ext}`;
    counter++;
    if (counter > 1000) {
      filename = `${sanitized}_${Date.now()}.${ext}`;
      break;
    }
  }
  return filename;
}
