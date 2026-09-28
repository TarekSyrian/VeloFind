import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { WorkerInit, WorkerInMessage, WorkerOutMessage } from '@shared/worker-protocol'

/**
 * مدير عامل الفحص — يدير دورة حياة Worker Thread — PRD §11 و§20
 * إنهاء قسري بعد مهلة عند الإلغاء لضمان عدم بقاء عامل عالق
 */

export class WorkerManager {
  private worker: Worker | null = null
  private terminatedByUs = false

  constructor(
    private readonly scriptDir: string,
    private readonly onMessage: (message: WorkerOutMessage) => void
  ) {}

  get running(): boolean {
    return this.worker !== null
  }

  start(init: WorkerInit): void {
    this.terminate()
    this.terminatedByUs = false

    const script = path.join(this.scriptDir, 'scan-worker.js')
    this.worker = new Worker(script, {
      workerData: init,
      resourceLimits: { maxOldGenerationSizeMb: 2048 }
    })

    this.worker.on('message', (message: WorkerOutMessage) => {
      this.onMessage(message)
      if (message.type === 'done' || message.type === 'error') {
        this.worker = null
      }
    })

    this.worker.on('error', (error) => {
      this.onMessage({ type: 'error', message: error.message, code: 'WORKER' })
      this.worker = null
    })

    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.terminatedByUs && this.worker !== null) {
        this.onMessage({ type: 'error', message: `توقف عامل الفحص بشكل غير متوقع (رمز ${code})`, code: 'WORKER' })
      }
      this.worker = null
    })
  }

  pause(): void {
    this.post({ type: 'pause' })
  }

  resume(): void {
    this.post({ type: 'resume' })
  }

  cancel(): void {
    this.post({ type: 'cancel' })
    // مهلة قصوى ثم إنهاء قسري
    setTimeout(() => {
      if (this.worker) this.terminate()
    }, 5000).unref?.()
  }

  private post(message: WorkerInMessage): void {
    this.worker?.postMessage(message)
  }

  terminate(): void {
    if (this.worker) {
      this.terminatedByUs = true
      this.worker.terminate()
      this.worker = null
    }
  }
}
