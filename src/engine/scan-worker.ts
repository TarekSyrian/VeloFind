import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage, WorkerInit } from '@shared/worker-protocol'
import type { ScanPhase } from '@shared/types'
import { CancellationToken, PauseGate } from './concurrency'
import { ScanScheduler } from './scanner/scan-scheduler'
import { ScanCancelledError } from '@shared/errors'

/**
 * عامل الفحص — ينفذ خط الفحص كاملًا خارج الخيط الرئيسي حتى لا تتجمد الواجهة — PRD §20
 * يُبنى كملف مستقل scan-worker.js عبر electron-vite (input ثانٍ في main)
 */

const port = parentPort
if (!port) {
  throw new Error('scan-worker يجب تشغيله داخل Worker Thread')
}

const init = workerData as WorkerInit
const gate = new PauseGate()
const token = new CancellationToken()

const send = (message: WorkerOutMessage): void => {
  port.postMessage(message)
}

port.on('message', (message: WorkerInMessage) => {
  switch (message.type) {
    case 'pause':
      gate.setPaused(true)
      send({ type: 'phase', phase: 'paused' })
      break
    case 'resume':
      gate.setPaused(false)
      send({ type: 'phase', phase: currentPhase })
      break
    case 'cancel':
      token.cancel()
      break
  }
})

let currentPhase: ScanPhase = 'preparing'

const scheduler = new ScanScheduler(token, gate, {
  onPhase: (phase) => {
    currentPhase = phase
    send({ type: 'phase', phase })
  },
  onProgress: (snapshot) => {
    send({ type: 'progress', progress: snapshot })
  },
  onHashBatch: (updates) => {
    send({ type: 'hash-batch', updates, bytesRead: 0 })
  },
  onWarning: () => {
    /* التحذيرات تُجمع في النتيجة النهائية وتُرسل مع done */
  }
})

;(async () => {
  try {
    const result = await scheduler.run(init)
    send({
      type: 'done',
      files: result.files,
      removedIds: result.removedIds,
      groups: result.groups,
      summary: result.summary,
      stats: {
        indexedFiles: result.files.length,
        duplicateGroups: result.groups.length,
        duplicateFiles: result.groups.reduce((sum, g) => sum + g.fileCount, 0),
        reclaimableBytes: result.groups.reduce((sum, g) => sum + g.reclaimedBytes, 0),
        lastScanAt: Date.now(),
        volumes: [],
        indexStore: 'sqlite'
      },
      warnings: result.warnings,
      durationMs: result.durationMs,
      mode: result.mode
    })
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      send({ type: 'error', message: 'تم إلغاء الفحص', code: 'SCAN_CANCELLED' })
    } else {
      send({
        type: 'error',
        message: (error as Error)?.message ?? 'فشل غير متوقع أثناء الفحص',
        code: 'WORKER'
      })
    }
  } finally {
    port.unref()
  }
})()
