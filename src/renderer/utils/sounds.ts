import scanDoneUrl from '@renderer/assets/sounds/scan-done.wav?url'
import operationDoneUrl from '@renderer/assets/sounds/operation-done.wav?url'
import notifyUrl from '@renderer/assets/sounds/notify.wav?url'

/**
 * محرك الأصوات — نغمات إشعارات واضحة ولطيفة مولدة خصيصًا لـ VeloFind
 * تُحمَّل كأصول Vite (تعمل في التطوير والحزمة) مع تخزين مؤقت لعناصر الصوت
 */

export type SoundName = 'scan-done' | 'operation-done' | 'notify'

const SOUND_URLS: Record<SoundName, string> = {
  'scan-done': scanDoneUrl,
  'operation-done': operationDoneUrl,
  notify: notifyUrl
}

const cache = new Map<SoundName, HTMLAudioElement>()

function getAudio(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name)
  if (!audio) {
    audio = new Audio(SOUND_URLS[name])
    audio.volume = 0.9
    audio.preload = 'auto'
    cache.set(name, audio)
  }
  return audio
}

/** تهيئة مسبقة خفيفة عند بدء التطبيق لتقليل زمن أول تشغيل */
export function preloadSounds(): void {
  try {
    for (const name of Object.keys(SOUND_URLS) as SoundName[]) {
      getAudio(name).load()
    }
  } catch {
    /* الأصوات اختيارية */
  }
}

/** تشغيل صوت حدث — يتجاهل بصمت عند تعطيل الإعداد أو فشل المتصفح */
export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return
  try {
    const audio = getAudio(name)
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  } catch {
    /* الأصوات اختيارية */
  }
}

/** هل الصوت مفعّل وفق الإعدادات الحالية؟ */
export function soundEnabled(settings: { notificationSound: boolean } | null): boolean {
  return settings?.notificationSound ?? true
}
