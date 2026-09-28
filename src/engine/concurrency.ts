import { ScanCancelledError } from '@shared/errors'

/**
 * أدوات التزامن لعامل الفحص:
 * - PauseGate: بوابة إيقاف مؤقت/استكمال
 * - CancellationToken: إلغاء تعاوني
 * - runPool: تجمع تنفيذ متوازٍ محدود — نحترم سرعة القرص والمعالج (PRD §20)
 */

export class PauseGate {
  private paused = false
  private waiters: Array<() => void> = []

  setPaused(value: boolean): void {
    this.paused = value
    if (!value) {
      const waiters = this.waiters.splice(0)
      for (const w of waiters) w()
    }
  }

  get isPaused(): boolean {
    return this.paused
  }

  async wait(): Promise<void> {
    while (this.paused) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
}

export class CancellationToken {
  private cancelled = false

  cancel(): void {
    this.cancelled = true
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new ScanCancelledError()
  }
}

/**
 * تنفيذ مهام على قائمة عناصر بحد أقصى للتوازي.
 * ملاحظة: worker يجب أن يلتقط أخطاءه غير القاتلة بنفسه؛
 * الأخطاء الوحيدة التي تُوقف المسبح هي الإلغاء.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  token: CancellationToken,
  gate: PauseGate
): Promise<void> {
  if (items.length === 0) return
  let cursor = 0
  const lanes = Math.max(1, Math.min(limit, items.length))

  const lane = async (): Promise<void> => {
    for (;;) {
      token.throwIfCancelled()
      await gate.wait()
      token.throwIfCancelled()
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()))
}
