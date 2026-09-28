/**
 * ربط Kernel32.dll عبر koffi — PRD §12
 * معزول تمامًا في هذه الطبقة؛ إن فشل التحميل (غير Windows أو غياب koffi)
 * ترجع الدالة null ويتحول النظام إلى الخطة البديلة fs — PRD §28
 */

export interface Kernel32Bindings {
  CreateFileW(path: string, access: number, share: number, security: null, disposition: number, flags: number, template: null): number | null
  CloseHandle(handle: number): number
  GetFileAttributesW(path: string): number
  DeviceIoControl(
    handle: number,
    code: number,
    inBuffer: unknown | null,
    inSize: number,
    outBuffer: unknown,
    outSize: number,
    bytesReturned: unknown
  ): number
  GetLastError(): number
  alloc(type: string, size?: number): unknown
  decode(buffer: unknown, type?: string): unknown
}

let cached: Kernel32Bindings | null | undefined

/** محاولة تحميل الربط؛ null عند عدم التوفر (fallback آمن) */
export async function tryLoadKernel32(): Promise<Kernel32Bindings | null> {
  if (cached !== undefined) return cached
  cached = null

  if (process.platform !== 'win32') return cached

  try {
    const mod = await import('koffi')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const koffi: any = (mod as { default?: unknown }).default ?? mod

    const lib = koffi.load('kernel32.dll')
    const CreateFileW = lib.func('__stdcall', 'CreateFileW', 'intptr', ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'void *'])
    const CloseHandle = lib.func('__stdcall', 'CloseHandle', 'int32', ['intptr'])
    const GetFileAttributesW = lib.func('__stdcall', 'GetFileAttributesW', 'uint32', ['str16'])
    const DeviceIoControl = lib.func('__stdcall', 'DeviceIoControl', 'int32', [
      'intptr',
      'uint32',
      'void *',
      'uint32',
      'void *',
      'uint32',
      'void *',
      'void *'
    ])
    const GetLastError = lib.func('__stdcall', 'GetLastError', 'uint32', [])

    cached = {
      CreateFileW: (path, access, share, security, disposition, flags, template) =>
        CreateFileW(path, access, share, security, disposition, flags, template),
      CloseHandle: (handle) => CloseHandle(handle),
      GetFileAttributesW: (path) => GetFileAttributesW(path),
      DeviceIoControl: (handle, code, inBuffer, inSize, outBuffer, outSize, bytesReturned) =>
        DeviceIoControl(handle, code, inBuffer, inSize, outBuffer, outSize, bytesReturned, null),
      GetLastError: () => GetLastError(),
      alloc: (type, size) => (size === undefined ? koffi.alloc(type) : koffi.alloc(type, size)),
      decode: (buffer, type) => (type === undefined ? koffi.decode(buffer) : koffi.decode(buffer, type))
    }
  } catch (error) {
    console.warn('[velofind] تعذر تحميل Windows API عبر koffi؛ سيتم استخدام البديل:', error)
  }

  return cached
}

/** هل المقبض صالح؟ (intptr: null أو -1 يعني فشل) */
export function isValidHandle(handle: number | null | undefined): handle is number {
  return handle !== null && handle !== undefined && handle !== -1
}

export const WIN32 = {
  GENERIC_READ: 0x80000000,
  FILE_SHARE_READ: 0x00000001,
  FILE_SHARE_WRITE: 0x00000002,
  FILE_SHARE_DELETE: 0x00000004,
  OPEN_EXISTING: 3,
  FILE_FLAG_BACKUP_SEMANTICS: 0x02000000,
  INVALID_HANDLE_VALUE: -1
}
