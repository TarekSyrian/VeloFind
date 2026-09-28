import { VeloFindError } from '@shared/errors'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type {
  AppSettings,
  FileOperationRecord,
  IndexedFile,
  SavedLocation
} from '@shared/types'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

/**
 * مدير التخزين الدائم — يطبق مخطط قاعدة البيانات من PRD §21
 * الخيار الأول: SQLite عبر better-sqlite3
 * الخطة البديلة (fallback): ملف JSON — عندما يتعذر تحميل الوحدة الأصلية (PRD §28)
 */

export interface HashPatch {
  id: number
  partialHash?: string
  fullHash?: string
  algorithm?: string
  scannedAt: number
}

export interface VolumeRow {
  id: string
  driveLetter: string
  fileSystem?: string
  serialNumber?: string
  journalId?: string
  nextUsn?: string
  lastScanAt?: number | null
  scanState?: string
}

export interface PersistenceStore {
  readonly kind: 'sqlite' | 'json'
  init(): Promise<void>
  close(): Promise<void>
  flush(): Promise<void>

  loadFiles(): Promise<IndexedFile[]>
  replaceFiles(files: IndexedFile[]): Promise<void>
  updateFileHashes(updates: HashPatch[]): Promise<void>
  deleteFiles(ids: number[]): Promise<void>
  clearFiles(): Promise<void>

  loadVolumes(): Promise<VolumeRow[]>
  upsertVolume(volume: VolumeRow): Promise<void>

  loadLocations(): Promise<SavedLocation[]>
  saveLocations(locations: SavedLocation[]): Promise<void>

  logOperation(op: Omit<FileOperationRecord, 'id'>): Promise<number>
  loadOperations(): Promise<FileOperationRecord[]>
  markOperationReversed(id: number, reversedAt: number): Promise<void>

  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
}

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  theme: 'theme',
  language: 'language',
  confirmOperations: 'confirmOperations',
  launchOnStartup: 'launchOnStartup',
  minimizeToTray: 'minimizeToTray',
  deleteMode: 'deleteMode',
  quarantinePath: 'quarantinePath',
  minFileSize: 'minFileSize',
  scanModeDefault: 'scanModeDefault',
  hashWorkers: 'hashWorkers',
  autoScanOnStart: 'autoScanOnStart',
  useUsnJournal: 'useUsnJournal',
  recheckBeforeDelete: 'recheckBeforeDelete',
  excludeSystemFolders: 'excludeSystemFolders',
  includeHiddenFiles: 'includeHiddenFiles',
  excludedFolders: 'excludedFolders',
  notificationsEnabled: 'notificationsEnabled',
  notificationSound: 'notificationSound',
  lastPage: 'lastPage'
}

function serializeSetting(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function parseSetting(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** تحميل الإعدادات من المخزن مع دمجها مع الافتراضيات */
type SettingsKV = Pick<PersistenceStore, 'getSetting' | 'setSetting'>

export async function loadSettingsFrom(store: SettingsKV): Promise<AppSettings> {
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(SETTING_KEYS) as Array<keyof AppSettings>) {
    const value = parseSetting(await store.getSetting(SETTING_KEYS[key]))
    if (value !== undefined && value !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(settings as any)[key] = value
    }
  }
  return settings
}

export async function saveSettingsTo(store: SettingsKV, patch: Partial<AppSettings>): Promise<void> {
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    if (field in patch) {
      await store.setSetting(key, serializeSetting(patch[field as keyof AppSettings]))
    }
  }
}

/* ------------------------------------------------------------------ */
/*                             SQLite                                 */
/* ------------------------------------------------------------------ */

export class SqliteStore implements PersistenceStore {
  readonly kind = 'sqlite' as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db!: any

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    // تحميل ديناميكي: إن فشلت الوحدة الأصلية يلتقطه PersistenceManager ويتحول إلى JSON
    const mod = await import('better-sqlite3')
    const Database = (mod as { default: new (p: string, o?: object) => unknown }).default
    await fsp.mkdir(path.dirname(this.dbPath), { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')

    // المخطط حسب PRD §21
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        volume_id TEXT NOT NULL,
        parent_id INTEGER,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        extension TEXT,
        size INTEGER NOT NULL,
        modified_at INTEGER,
        created_at INTEGER,
        attributes INTEGER,
        partial_hash TEXT,
        full_hash TEXT,
        hash_algorithm TEXT,
        last_scanned_at INTEGER,
        scan_state TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
      CREATE INDEX IF NOT EXISTS idx_files_full_hash ON files(full_hash);

      CREATE TABLE IF NOT EXISTS volumes (
        id TEXT PRIMARY KEY,
        drive_letter TEXT,
        file_system TEXT,
        serial_number TEXT,
        journal_id TEXT,
        next_usn INTEGER,
        last_scan_at INTEGER,
        scan_state TEXT
      );

      CREATE TABLE IF NOT EXISTS scan_locations (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        excluded INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS file_operations (
        id INTEGER PRIMARY KEY,
        operation_type TEXT NOT NULL,
        source_path TEXT NOT NULL,
        destination_path TEXT,
        created_at INTEGER NOT NULL,
        reversed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  async close(): Promise<void> {
    this.db?.close?.()
  }

  async flush(): Promise<void> {
    /* SQLite يكتب فورًا — لا شيء مطلوب */
  }

  async loadFiles(): Promise<IndexedFile[]> {
    const rows = this.db.prepare('SELECT * FROM files').all() as Array<Record<string, unknown>>
    return rows.map(rowToFile)
  }

  async replaceFiles(files: IndexedFile[]): Promise<void> {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO files
        (id, volume_id, parent_id, name, path, extension, size, modified_at, created_at,
         attributes, partial_hash, full_hash, hash_algorithm, last_scanned_at, scan_state)
      VALUES
        (@id, @volumeId, NULL, @name, @path, @extension, @size, @modifiedAt, @createdAt,
         @attributes, @partialHash, @fullHash, @hashAlgorithm, @lastScannedAt, @scanState)
    `)
    // استبدال حقيقي: حذف القديم كاملًا ثم إدراج اللقطة داخل معاملة واحدة —
    // لا يجوز أن تبقى صفوف من لقطات سابقة (كان يُعيد إحياء أقراص محذوفة عند إعادة التشغيل)
    const tx = this.db.transaction((batch: IndexedFile[]) => {
      this.db.exec('DELETE FROM files')
      for (const file of batch) insert.run(fileToRow(file))
    })
    tx(files)
  }

  async updateFileHashes(updates: HashPatch[]): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE files
      SET partial_hash = COALESCE(?, partial_hash),
          full_hash = COALESCE(?, full_hash),
          hash_algorithm = COALESCE(?, hash_algorithm),
          last_scanned_at = ?
      WHERE id = ?
    `)
    const tx = this.db.transaction((batch: HashPatch[]) => {
      for (const u of batch) {
        stmt.run(u.partialHash ?? null, u.fullHash ?? null, u.algorithm ?? null, u.scannedAt, u.id)
      }
    })
    tx(updates)
  }

  async deleteFiles(ids: number[]): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM files WHERE id = ?')
    const tx = this.db.transaction((batch: number[]) => {
      for (const id of batch) stmt.run(id)
    })
    for (let i = 0; i < ids.length; i += 1000) tx(ids.slice(i, i + 1000))
  }

  async clearFiles(): Promise<void> {
    this.db.exec('DELETE FROM files')
  }

  async loadVolumes(): Promise<VolumeRow[]> {
    const rows = this.db.prepare('SELECT * FROM volumes').all() as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r['id']),
      driveLetter: String(r['drive_letter'] ?? ''),
      fileSystem: (r['file_system'] as string) ?? undefined,
      serialNumber: (r['serial_number'] as string) ?? undefined,
      journalId: (r['journal_id'] as string) ?? undefined,
      nextUsn: r['next_usn'] === null || r['next_usn'] === undefined ? undefined : String(r['next_usn']),
      lastScanAt: (r['last_scan_at'] as number | null) ?? null,
      scanState: (r['scan_state'] as string) ?? undefined
    }))
  }

  async upsertVolume(volume: VolumeRow): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO volumes
           (id, drive_letter, file_system, serial_number, journal_id, next_usn, last_scan_at, scan_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        volume.id,
        volume.driveLetter,
        volume.fileSystem ?? null,
        volume.serialNumber ?? null,
        volume.journalId ?? null,
        volume.nextUsn === undefined ? null : Number(volume.nextUsn),
        volume.lastScanAt ?? null,
        volume.scanState ?? null
      )
  }

  async loadLocations(): Promise<SavedLocation[]> {
    const rows = this.db
      .prepare('SELECT path, enabled, excluded FROM scan_locations ORDER BY id')
      .all() as Array<{ path: string; enabled: number; excluded: number }>
    return rows.map((r) => ({ path: r.path, enabled: !!r.enabled, excluded: !!r.excluded }))
  }

  async saveLocations(locations: SavedLocation[]): Promise<void> {
    const tx = this.db.transaction((locs: SavedLocation[]) => {
      this.db.exec('DELETE FROM scan_locations')
      const stmt = this.db.prepare('INSERT INTO scan_locations (path, enabled, excluded) VALUES (?, ?, ?)')
      for (const loc of locs) stmt.run(loc.path, loc.enabled ? 1 : 0, loc.excluded ? 1 : 0)
    })
    tx(locations)
  }

  async logOperation(op: Omit<FileOperationRecord, 'id'>): Promise<number> {
    const result = this.db
      .prepare('INSERT INTO file_operations (operation_type, source_path, destination_path, created_at, reversed_at) VALUES (?, ?, ?, ?, ?)')
      .run(op.operationType, op.sourcePath, op.destinationPath ?? null, op.createdAt, op.reversedAt ?? null)
    return Number(result.lastInsertRowid)
  }

  async loadOperations(): Promise<FileOperationRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM file_operations ORDER BY id DESC LIMIT 500')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: Number(r['id']),
      operationType: r['operation_type'] as FileOperationRecord['operationType'],
      sourcePath: String(r['source_path']),
      destinationPath: (r['destination_path'] as string | null) ?? null,
      createdAt: Number(r['created_at']),
      reversedAt: (r['reversed_at'] as number | null) ?? null
    }))
  }

  async markOperationReversed(id: number, reversedAt: number): Promise<void> {
    this.db.prepare('UPDATE file_operations SET reversed_at = ? WHERE id = ?').run(reversedAt, id)
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }
}

function fileToRow(file: IndexedFile): Record<string, unknown> {
  return {
    id: file.id,
    volumeId: file.volumeId,
    name: file.name,
    path: file.path,
    extension: file.extension,
    size: file.size,
    modifiedAt: file.modifiedAt,
    createdAt: file.createdAt,
    attributes: file.attributes,
    partialHash: file.partialHash ?? null,
    fullHash: file.fullHash ?? null,
    hashAlgorithm: file.hashAlgorithm ?? null,
    lastScannedAt: file.lastScannedAt ?? null,
    scanState: file.scanState
  }
}

function rowToFile(row: Record<string, unknown>): IndexedFile {
  return {
    id: Number(row['id']),
    volumeId: String(row['volume_id'] ?? '?'),
    name: String(row['name'] ?? ''),
    path: String(row['path'] ?? ''),
    directory: path.dirname(String(row['path'] ?? '')),
    extension: String(row['extension'] ?? ''),
    size: Number(row['size'] ?? 0),
    modifiedAt: Number(row['modified_at'] ?? 0),
    createdAt: Number(row['created_at'] ?? 0),
    attributes: Number(row['attributes'] ?? 0),
    isHidden: false,
    partialHash: (row['partial_hash'] as string | null) ?? undefined,
    fullHash: (row['full_hash'] as string | null) ?? undefined,
    hashAlgorithm: (row['hash_algorithm'] as string | null) ?? undefined,
    lastScannedAt: (row['last_scanned_at'] as number | null) ?? undefined,
    scanState: (row['scan_state'] as IndexedFile['scanState'] ?? 'scanned')
  }
}

/* ------------------------------------------------------------------ */
/*                           JSON (fallback)                          */
/* ------------------------------------------------------------------ */

interface JsonSnapshot {
  files: IndexedFile[]
  volumes: VolumeRow[]
  locations: SavedLocation[]
  operations: FileOperationRecord[]
  settings: Record<string, string>
  nextOpId: number
}

export class JsonStore implements PersistenceStore {
  readonly kind = 'json' as const
  private data: JsonSnapshot = {
    files: [],
    volumes: [],
    locations: [],
    operations: [],
    settings: {},
    nextOpId: 1
  }
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = await fsp.readFile(this.filePath, 'utf-8')
      this.data = { ...this.data, ...(JSON.parse(raw) as JsonSnapshot) }
    } catch {
      /* ملف جديد */
    }
  }

  async close(): Promise<void> {
    await this.flush()
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = this.filePath + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf-8')
    await fsp.rename(tmp, this.filePath)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush().catch(() => undefined)
    }, 800)
  }

  async loadFiles(): Promise<IndexedFile[]> {
    return this.data.files
  }

  async replaceFiles(files: IndexedFile[]): Promise<void> {
    this.data.files = files
    this.scheduleSave()
  }

  async updateFileHashes(updates: HashPatch[]): Promise<void> {
    const byId = new Map(this.data.files.map((f) => [f.id, f]))
    for (const u of updates) {
      const file = byId.get(u.id)
      if (!file) continue
      if (u.partialHash !== undefined) file.partialHash = u.partialHash
      if (u.fullHash !== undefined) file.fullHash = u.fullHash
      if (u.algorithm !== undefined) file.hashAlgorithm = u.algorithm
      file.lastScannedAt = u.scannedAt
    }
    this.scheduleSave()
  }

  async deleteFiles(ids: number[]): Promise<void> {
    const remove = new Set(ids)
    this.data.files = this.data.files.filter((f) => !remove.has(f.id))
    this.scheduleSave()
  }

  async clearFiles(): Promise<void> {
    this.data.files = []
    this.scheduleSave()
  }

  async loadVolumes(): Promise<VolumeRow[]> {
    return this.data.volumes
  }

  async upsertVolume(volume: VolumeRow): Promise<void> {
    const index = this.data.volumes.findIndex((v) => v.id === volume.id)
    if (index >= 0) this.data.volumes[index] = volume
    else this.data.volumes.push(volume)
    this.scheduleSave()
  }

  async loadLocations(): Promise<SavedLocation[]> {
    return this.data.locations
  }

  async saveLocations(locations: SavedLocation[]): Promise<void> {
    this.data.locations = locations
    this.scheduleSave()
  }

  async logOperation(op: Omit<FileOperationRecord, 'id'>): Promise<number> {
    const id = this.data.nextOpId++
    this.data.operations.unshift({ ...op, id })
    this.data.operations = this.data.operations.slice(0, 500)
    this.scheduleSave()
    return id
  }

  async loadOperations(): Promise<FileOperationRecord[]> {
    return this.data.operations
  }

  async markOperationReversed(id: number, reversedAt: number): Promise<void> {
    const op = this.data.operations.find((o) => o.id === id)
    if (op) op.reversedAt = reversedAt
    this.scheduleSave()
  }

  async getSetting(key: string): Promise<string | null> {
    return this.data.settings[key] ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.data.settings[key] = value
    this.scheduleSave()
  }
}

/* ------------------------------------------------------------------ */
/*                              المدير                                */
/* ------------------------------------------------------------------ */

export class PersistenceManager {
  private constructor(
    private readonly store: PersistenceStore,
    readonly dbPath: string
  ) {}

  get kind(): 'sqlite' | 'json' {
    return this.store.kind
  }

  /** إنشاء المخزن: SQLite أولًا، وJSON كخطة بديلة عند فشل الوحدة الأصلية */
  static async create(userDataDir: string, preferredDbPath?: string): Promise<PersistenceManager> {
    const sqlitePath = preferredDbPath ?? path.join(userDataDir, 'velofind.db')
    try {
      const store = new SqliteStore(sqlitePath)
      await store.init()
      return new PersistenceManager(store, sqlitePath)
    } catch (error) {
      const jsonPath = path.join(userDataDir, 'velofind-index.json')
      const store = new JsonStore(jsonPath)
      await store.init()
      console.warn('[velofind] تعذر تحميل SQLite؛ سيتم استخدام مخزن JSON البديل:', error)
      return new PersistenceManager(store, jsonPath)
    }
  }

  loadFiles(): Promise<IndexedFile[]> {
    return this.store.loadFiles()
  }
  replaceFiles(files: IndexedFile[]): Promise<void> {
    return this.store.replaceFiles(files)
  }
  updateFileHashes(updates: HashPatch[]): Promise<void> {
    return this.store.updateFileHashes(updates)
  }
  deleteFiles(ids: number[]): Promise<void> {
    return this.store.deleteFiles(ids)
  }
  clearFiles(): Promise<void> {
    return this.store.clearFiles()
  }
  loadVolumes(): Promise<VolumeRow[]> {
    return this.store.loadVolumes()
  }
  upsertVolume(volume: VolumeRow): Promise<void> {
    return this.store.upsertVolume(volume)
  }
  loadLocations(): Promise<SavedLocation[]> {
    return this.store.loadLocations()
  }
  saveLocations(locations: SavedLocation[]): Promise<void> {
    return this.store.saveLocations(locations)
  }
  logOperation(op: Omit<FileOperationRecord, 'id'>): Promise<number> {
    return this.store.logOperation(op)
  }
  loadOperations(): Promise<FileOperationRecord[]> {
    return this.store.loadOperations()
  }
  markOperationReversed(id: number, reversedAt: number): Promise<void> {
    return this.store.markOperationReversed(id, reversedAt)
  }
  getSetting(key: string): Promise<string | null> {
    return this.store.getSetting(key)
  }
  setSetting(key: string, value: string): Promise<void> {
    return this.store.setSetting(key, value)
  }
  async loadSettings(): Promise<AppSettings> {
    return loadSettingsFrom(this.store)
  }
  async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    await saveSettingsTo(this.store, patch)
  }
  async flush(): Promise<void> {
    await this.store.flush()
  }
  async close(): Promise<void> {
    await this.store.close()
  }
}

/** التحقق من قابلية الكتابة على مجلد (تُستخدم للعزل) */
export async function ensureWritableDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.access(dir, fs.constants.W_OK)
}

export { VeloFindError }
