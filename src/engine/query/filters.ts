import type { FileSummary, IndexedFile } from '@shared/types'
import type { MemoryIndex } from '../index/memory-index'
import type { CmpOp, ParsedQuery, QueryTerm } from './query-parser'
import { globToRegExp } from './query-parser'
import { pathKey } from '../path-utils'

/**
 * تطبيق شروط البحث على الفهرس — PRD §19
 * جميع الشروط تُربط بـ AND
 */

export interface QueryContext {
  /** معرفات الملفات التي تنتمي لمجموعة تكرار */
  duplicateFileIds: Set<number>
}

function compare(value: number, op: CmpOp, target: number): boolean {
  switch (op) {
    case '>':
      return value > target
    case '<':
      return value < target
    case '>=':
      return value >= target
    case '<=':
      return value <= target
    case '=':
    default:
      return value === target
  }
}

function matchTerm(file: IndexedFile, term: QueryTerm, ctx: QueryContext): boolean {
  switch (term.kind) {
    case 'text': {
      const name = file.name.toLowerCase()
      const p = file.path.toLowerCase()
      return name.includes(term.value) || p.includes(term.value)
    }
    case 'name':
      return file.name.toLowerCase().includes(term.value)
    case 'ext':
      return (file.extension || '').toLowerCase() === term.value
    case 'size':
      return compare(file.size, term.op, term.bytes)
    case 'modified':
      return compare(file.modifiedAt, term.op, term.timestamp)
    case 'path':
      return pathKey(file.path).includes(term.value)
    case 'duplicate':
      return ctx.duplicateFileIds.has(file.id)
    case 'glob':
      return globToRegExp(term.pattern).test(file.name.toLowerCase())
  }
}

export function matchesQuery(file: IndexedFile, parsed: ParsedQuery, ctx: QueryContext): boolean {
  return parsed.terms.every((term) => matchTerm(file, term, ctx))
}

export interface SearchOptions {
  limit?: number
}

/** تنفيذ بحث كامل على الفهرس وإرجاع ملخصات الملفات المطابقة */
export function searchFiles(
  index: MemoryIndex,
  parsed: ParsedQuery,
  ctx: QueryContext,
  options: SearchOptions = {}
): { files: FileSummary[]; total: number; tookMs: number } {
  const startedAt = Date.now()
  const results: FileSummary[] = []
  const limit = options.limit ?? 100

  for (const file of index.all()) {
    if (!matchesQuery(file, parsed, ctx)) continue
    results.push({
      id: file.id,
      name: file.name,
      path: file.path,
      directory: file.directory,
      drive: file.path.charAt(0).toUpperCase() || '?',
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
      inDuplicateGroup: ctx.duplicateFileIds.has(file.id)
    })
  }

  // الأحدث تعديلًا أولًا
  results.sort((a, b) => b.modifiedAt - a.modifiedAt)

  return {
    files: results.slice(0, limit),
    total: results.length,
    tookMs: Date.now() - startedAt
  }
}
