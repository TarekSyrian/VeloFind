/**
 * المسارات الحقيقية لمجلدات النظام تُستخرج من بيئة التشغيل (وليس من مطابقة أسماء):
 * C:\Windows وProgram Files وProgramData… تُستثنى هي فقط، حتى لا يُستثنى بالخطأ
 * مجلد عادي يحمل الاسم نفسه على قرص آخر (مثل L:\Windows الخاص بالمستخدم).
 *
 * وحدة خاصة بمحرك Node (عامل الفحص) — لا تُستورد من شيفرة الواجهة أبدًا.
 */

export function resolveSystemFolderPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = []
  const push = (value: string | undefined): void => {
    if (value && value.trim()) out.push(value.trim())
  }
  push(env.SystemRoot)
  push(env.windir)
  push(env.ProgramFiles)
  push(env['ProgramFiles(x86)'])
  push(env.ProgramData)
  // Recovery وPerfLogs تقعان على قرص النظام عادةً
  const sysDrive = (env.SystemDrive ?? 'C:').replace(/[\\]+$/, '')
  if (/^[a-zA-Z]:$/.test(sysDrive)) {
    out.push(`${sysDrive}\\Recovery`)
    out.push(`${sysDrive}\\PerfLogs`)
  }
  return out
}
