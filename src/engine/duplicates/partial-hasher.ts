import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { FileAccessError } from '@shared/errors'
import { HASH_ALGORITHM, PARTIAL_HASH_CHUNK } from '@shared/constants'
import type { CancellationToken } from '../concurrency'
import { toWindowsLongPath } from '../path-utils'

/**
 * المرحلة الثالثة: البصمة الجزئية — PRD §8
 * partialHash(file) = hash(first + middle + last)
 * تقلل القراءة من القرص قبل تنفيذ البصمة الكاملة
 */

export interface ByteRange {
  start: number
  end: number
}

/** حساب نطاقات القراءة (بداية/منتصف/نهاية) مع دمج التداخلات وترتيبها */
export function computePartialRanges(size: number, chunk = PARTIAL_HASH_CHUNK): ByteRange[] {
  if (size <= 0) return []
  // الملفات الصغيرة: تُقرأ كاملة دفعة واحدة
  if (size <= chunk * 3) return [{ start: 0, end: size }]

  const ranges: ByteRange[] = [
    { start: 0, end: Math.min(chunk, size) },
    { start: Math.max(0, size - chunk), end: size }
  ]
  const midStart = Math.floor((size - chunk) / 2)
  ranges.push({ start: midStart, end: midStart + chunk })

  return mergeRanges(ranges)
}

/** دمج نطاقات متداخلة/متجاورة وترتيبها */
export function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: ByteRange[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const current = sorted[i]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }
  return merged
}

/**
 * حساب البصمة الجزئية لملف.
 * اختلفت البصمة الجزئية → الملفان ليسا مكررين (يُوفر قراءة كاملة) — PRD §8
 */
export async function computePartialHash(filePath: string, size: number, token?: CancellationToken): Promise<string> {
  const handle = await fs.open(toWindowsLongPath(filePath), 'r').catch((error) => {
    throw new FileAccessError(`تعذر فتح الملف للقراءة: ${filePath}`, error)
  })

  try {
    const ranges = computePartialRanges(size)
    const total = ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
    const buffer = Buffer.allocUnsafe(total)
    let offset = 0

    for (const range of ranges) {
      token?.throwIfCancelled()
      const length = range.end - range.start
      const { bytesRead } = await handle.read(buffer, offset, length, range.start)
      if (bytesRead < length) {
        // الملف أصغر مما أعلن (تغير أثناء القراءة) — نلتقط ما تمت قراءته فقط
        return createHash(HASH_ALGORITHM).update(buffer.subarray(0, offset + bytesRead)).digest('hex')
      }
      offset += bytesRead
    }

    return createHash(HASH_ALGORITHM).update(buffer.subarray(0, offset)).digest('hex')
  } finally {
    await handle.close()
  }
}
