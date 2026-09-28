/**
 * محلل استعلامات البحث — PRD §19
 * يدعم: نص حر، name:، ext:، size:>100MB، path:، modified:>2024-01-01،
 * wildcard (*.jpg)، وكلمة duplicate/مكرر لعرض الملفات داخل مجموعات التكرار
 */

export type CmpOp = '>' | '<' | '>=' | '<=' | '='

export type QueryTerm =
  | { kind: 'text'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'ext'; value: string }
  | { kind: 'size'; op: CmpOp; bytes: number }
  | { kind: 'modified'; op: CmpOp; timestamp: number }
  | { kind: 'path'; value: string }
  | { kind: 'duplicate' }
  | { kind: 'glob'; pattern: string }

export interface ParsedQuery {
  raw: string
  terms: QueryTerm[]
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 ** 2,
  m: 1024 ** 2,
  gb: 1024 ** 3,
  g: 1024 ** 3,
  tb: 1024 ** 4,
  t: 1024 ** 4
}

/** تحويل نص حجم مثل "100MB" أو "1.5GB" إلى بايتات */
export function parseSize(input: string): number | null {
  const match = /^\s*([\d.]+)\s*([a-zA-Z]+)?\s*$/.exec(input)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0) return null
  const unit = (match[2] ?? 'b').toLowerCase()
  const multiplier = SIZE_UNITS[unit]
  if (!multiplier) return null
  return Math.round(value * multiplier)
}

/** تحويل تاريخ بصيغة YYYY-MM-DD أو YYYY/MM/DD إلى طابع زمني */
export function parseDate(input: string): number | null {
  const normalized = input.replace(/\//g, '-')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const time = Date.parse(normalized + 'T00:00:00Z')
  return Number.isNaN(time) ? null : time
}

/** تحويل نمط wildcard إلى تعبير نمطي: *.jpg، report*، *final* */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/** تقسيم النص إلى رموز مع دعم key:"قيمة ذات مسافات" و"قيمة مقتبسة" */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    // نمط key:"قيمة ذات مسافات"
    const keyQuoted = /^(\w+):"([^"]*)"/.exec(input.slice(i))
    if (keyQuoted) {
      tokens.push(`${keyQuoted[1]}:${keyQuoted[2]}`)
      i += keyQuoted[0].length
      continue
    }

    // قيمة مقتبسة بلا مفتاح
    if (ch === '"') {
      const end = input.indexOf('"', i + 1)
      if (end > i) {
        tokens.push(input.slice(i + 1, end))
        i = end + 1
        continue
      }
    }

    // رمز عادي حتى المسافة التالية
    let j = i
    while (j < input.length && !/\s/.test(input[j])) j += 1
    tokens.push(input.slice(i, j))
    i = j
  }
  return tokens
}

function parseComparison(value: string): { op: CmpOp; rest: string } | null {
  const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(value)
  if (!match) return null
  return { op: (match[1] ?? '=') as CmpOp, rest: match[2] }
}

/** تحليل استعلام إلى شروط قابلة للمطابقة */
export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim()
  const terms: QueryTerm[] = []

  for (const token of tokenize(raw)) {
    const lower = token.toLowerCase()

    if (lower === 'duplicate' || lower === 'مكرر' || lower === 'duplicates') {
      terms.push({ kind: 'duplicate' })
      continue
    }

    const colon = token.indexOf(':')
    if (colon > 0) {
      const key = lower.slice(0, colon)
      const value = token.slice(colon + 1)
      if (value.length > 0) {
        switch (key) {
          case 'name': {
            terms.push({ kind: 'name', value: value.toLowerCase() })
            continue
          }
          case 'ext':
          case 'extension': {
            terms.push({ kind: 'ext', value: value.replace(/^\./, '').toLowerCase() })
            continue
          }
          case 'size': {
            const cmp = parseComparison(value)
            const bytes = cmp ? parseSize(cmp.rest) : null
            if (cmp && bytes !== null) {
              terms.push({ kind: 'size', op: cmp.op, bytes })
              continue
            }
            break
          }
          case 'modified':
          case 'date': {
            const cmp = parseComparison(value)
            const timestamp = cmp ? parseDate(cmp.rest) : null
            if (cmp && timestamp !== null) {
              terms.push({ kind: 'modified', op: cmp.op, timestamp })
              continue
            }
            break
          }
          case 'path': {
            terms.push({ kind: 'path', value: value.toLowerCase() })
            continue
          }
        }
      }
    }

    if (token.includes('*') || token.includes('?')) {
      terms.push({ kind: 'glob', pattern: lower })
      continue
    }

    if (token.startsWith('.')) {
      terms.push({ kind: 'ext', value: lower.slice(1) })
      continue
    }

    terms.push({ kind: 'text', value: lower })
  }

  return { raw, terms }
}
