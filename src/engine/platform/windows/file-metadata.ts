import { tryLoadKernel32 } from './kernel32'
import { FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SYSTEM } from './constants'

/**
 * خصائص ملفات Windows عبر GetFileAttributesW — طبقة FFI معزولة مع fallback
 */

export { FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SYSTEM }

const INVALID_FILE_ATTRIBUTES = 0xffffffff

/** قراءة خصائص الملف؛ null عند فشل FFI أو عدم التوفر (غير Windows) */
export async function getFileAttributesWindows(filePath: string): Promise<number | null> {
  const k32 = await tryLoadKernel32()
  if (!k32) return null
  try {
    const attrs = k32.GetFileAttributesW(filePath)
    if (attrs === INVALID_FILE_ATTRIBUTES) return null
    return attrs
  } catch {
    return null
  }
}

export function isHiddenAttribute(attrs: number): boolean {
  return (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0
}

export function isSystemAttribute(attrs: number): boolean {
  return (attrs & FILE_ATTRIBUTE_SYSTEM) !== 0
}

export function isDirectoryAttribute(attrs: number): boolean {
  return (attrs & FILE_ATTRIBUTE_DIRECTORY) !== 0
}

export function isReparsePointAttribute(attrs: number): boolean {
  return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0
}
