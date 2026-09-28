import { describe, expect, it } from 'vitest'
import { parseQuery, parseSize, parseDate, globToRegExp } from '@engine/query/query-parser'

describe('parseSize', () => {
  it('يفهم الوحدات', () => {
    expect(parseSize('100MB')).toBe(100 * 1024 ** 2)
    expect(parseSize('1.5GB')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseSize('512B')).toBe(512)
    expect(parseSize('10kb')).toBe(10 * 1024)
  })
  it('يرفض النصوص غير الصالحة', () => {
    expect(parseSize('abc')).toBeNull()
    expect(parseSize('-5MB')).toBeNull()
  })
})

describe('parseDate', () => {
  it('يقبل YYYY-MM-DD وYYYY/MM/DD', () => {
    expect(parseDate('2024-01-01')).toBe(Date.parse('2024-01-01T00:00:00Z'))
    expect(parseDate('2024/01/01')).toBe(parseDate('2024-01-01'))
  })
  it('يرفض التواريخ غير الصالحة', () => {
    expect(parseDate('yesterday')).toBeNull()
  })
})

describe('parseQuery — أمثلة PRD §19', () => {
  it('نص حر', () => {
    const q = parseQuery('invoice')
    expect(q.terms).toEqual([{ kind: 'text', value: 'invoice' }])
  })

  it('ext:mp4', () => {
    expect(parseQuery('ext:mp4').terms).toEqual([{ kind: 'ext', value: 'mp4' }])
  })

  it('size:>100MB', () => {
    expect(parseQuery('size:>100MB').terms).toEqual([{ kind: 'size', op: '>', bytes: 100 * 1024 ** 2 }])
  })

  it('path:C:\\Users', () => {
    expect(parseQuery('path:C:\\Users').terms).toEqual([{ kind: 'path', value: 'c:\\users' }])
  })

  it('duplicate ككلمة مفتاحية', () => {
    expect(parseQuery('duplicate').terms).toEqual([{ kind: 'duplicate' }])
    expect(parseQuery('مكرر').terms).toEqual([{ kind: 'duplicate' }])
  })

  it('wildcard *.jpg', () => {
    expect(parseQuery('*.jpg').terms).toEqual([{ kind: 'glob', pattern: '*.jpg' }])
    expect(globToRegExp('*.jpg').test('photo.jpg')).toBe(true)
    expect(globToRegExp('*.jpg').test('photo.png')).toBe(false)
  })

  it('استعلام مركب: name:invoice ext:pdf size:>1MB', () => {
    const q = parseQuery('name:invoice ext:pdf size:>1MB')
    expect(q.terms).toEqual([
      { kind: 'name', value: 'invoice' },
      { kind: 'ext', value: 'pdf' },
      { kind: 'size', op: '>', bytes: 1024 ** 2 }
    ])
  })

  it('يدعم الاقتباس للقيم ذات المسافات', () => {
    expect(parseQuery('name:"annual report"').terms).toEqual([{ kind: 'name', value: 'annual report' }])
  })
})
