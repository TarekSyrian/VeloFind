import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { FileAccessError } from '@shared/errors'
import { HASH_ALGORITHM, STREAM_CHUNK } from '@shared/constants'
import type { CancellationToken } from '../concurrency'
import { toWindowsLongPath } from '../path-utils'

/**
 * المرحلة الرابعة: البصمة الكاملة SHA-256 — PRD §8
 * تُحسب فقط للملفات التي لها الحجم نفسه والبصمة الجزئية نفسها
 */

export interface FullHashResult {
  hash: string
  bytesRead: number
}

/** حساب بصمة كاملة متدفقة (لا يُحمّل الملف كاملًا في الذاكرة) */
export async function computeFullHash(
  filePath: string,
  token?: CancellationToken,
  onBytes?: (bytes: number) => void
): Promise<FullHashResult> {
  return new Promise<FullHashResult>((resolve, reject) => {
    const stream = createReadStream(toWindowsLongPath(filePath), {
      highWaterMark: STREAM_CHUNK
    })
    const hash = createHash(HASH_ALGORITHM)
    let bytesRead = 0
    let settled = false

    stream.on('data', (chunk: string | Buffer) => {
      try {
        token?.throwIfCancelled()
      } catch (error) {
        settled = true
        stream.destroy()
        reject(error)
        return
      }
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      hash.update(buffer)
      bytesRead += buffer.length
      onBytes?.(buffer.length)
    })

    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      const friendly =
        error.code === 'EBUSY'
          ? 'الملف مقفل بواسطة برنامج آخر'
          : error.code === 'EACCES' || error.code === 'EPERM'
            ? 'لا توجد صلاحية لقراءة الملف'
            : 'تعذر قراءة محتوى الملف'
      reject(new FileAccessError(`${friendly}: ${filePath}`, error))
    })

    stream.on('end', () => {
      if (settled) return
      settled = true
      resolve({ hash: hash.digest('hex'), bytesRead })
    })
  })
}
