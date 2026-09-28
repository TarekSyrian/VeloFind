import type { SafetyViolation } from './types'

export type ErrorCode =
  | 'SCAN_CANCELLED'
  | 'FILE_ACCESS'
  | 'SAFETY_RULE'
  | 'HASH_MISMATCH'
  | 'WORKER'
  | 'PERSISTENCE'
  | 'UNSUPPORTED_PLATFORM'
  | 'SETTINGS'
  | 'UNKNOWN'

/** الخطأ الأساسي في VeloFind مع رمز قابل للعرض في الواجهة */
export class VeloFindError extends Error {
  readonly code: ErrorCode

  constructor(message: string, code: ErrorCode = 'UNKNOWN', cause?: unknown) {
    super(message)
    this.name = 'VeloFindError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** أُلغي الفحص بناءً على طلب المستخدم */
export class ScanCancelledError extends VeloFindError {
  constructor(message = 'تم إلغاء الفحص') {
    super(message, 'SCAN_CANCELLED')
    this.name = 'ScanCancelledError'
  }
}

/** فشل الوصول إلى ملف أو مجلد */
export class FileAccessError extends VeloFindError {
  constructor(message: string, cause?: unknown) {
    super(message, 'FILE_ACCESS', cause)
    this.name = 'FileAccessError'
  }
}

/** رُفضت عملية بسبب مخالفة قاعدة أمان — PRD §17 */
export class SafetyRuleError extends VeloFindError {
  readonly violations: SafetyViolation[]

  constructor(violations: SafetyViolation[], message = 'تعذّر تنفيذ العملية لاعتبارات أمنية') {
    super(message, 'SAFETY_RULE')
    this.name = 'SafetyRuleError'
    this.violations = violations
  }
}

/** تغيّر الملف منذ آخر فحص — تُوقف العملية بالكامل (PRD §17) */
export class HashMismatchError extends VeloFindError {
  constructor(message = 'تغيّر أحد الملفات منذ آخر فحص؛ تم إيقاف العملية') {
    super(message, 'HASH_MISMATCH')
    this.name = 'HashMismatchError'
  }
}
