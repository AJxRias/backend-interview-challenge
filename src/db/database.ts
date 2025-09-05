import sqlite3 from 'sqlite3';
import { Task, SyncQueueItem } from '../types';

const sqlite = sqlite3.verbose();

export class Database {
  private db: sqlite3.Database;

  constructor(filename: string = ':memory:') {
    this.db = new sqlite.Database(filename);
  }

  async initialize(): Promise<void> {
  // Drop old tables to ensure fresh schema in memory
  await this.run(`DROP TABLE IF EXISTS sync_queue`);
  await this.run(`DROP TABLE IF EXISTS dead_letter_queue`);
  await this.run(`DROP TABLE IF EXISTS tasks`);

  // Recreate everything
  await this.createTables();
 }


  private async createTables(): Promise<void> {
    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        sync_status TEXT DEFAULT 'pending',
        server_id TEXT,
        last_synced_at DATETIME
      )
    `;

    const createSyncQueueTable = `
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `;

    // ✅ NEW: Dead letter queue for failed syncs
    const createDeadLetterQueueTable = `
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT,
        failed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.run(createTasksTable);
    await this.run(createSyncQueueTable);
    await this.run(createDeadLetterQueueTable); // ensure dead letter queue exists
  }

  // Helper methods
  run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ---- Task methods ----
  async insertTask(task: Task): Promise<void> {
    await this.run(
      `INSERT INTO tasks (id, title, description, completed, created_at, updated_at, is_deleted, sync_status, server_id, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.description ?? null,
        task.completed ? 1 : 0,
        task.created_at ?? new Date().toISOString(),
        task.updated_at ?? new Date().toISOString(),
        task.is_deleted ? 1 : 0,
        task.sync_status ?? "pending",
        task.server_id ?? null,
        task.last_synced_at ?? null,
      ]
    );
  }

  async updateTask(task: Task): Promise<void> {
    await this.run(
      `UPDATE tasks
       SET title = ?, description = ?, completed = ?, updated_at = ?, is_deleted = ?, sync_status = ?, server_id = ?, last_synced_at = ?
       WHERE id = ?`,
      [
        task.title,
        task.description ?? null,
        task.completed ? 1 : 0,
        task.updated_at ?? new Date().toISOString(),
        task.is_deleted ? 1 : 0,
        task.sync_status ?? "pending",
        task.server_id ?? null,
        task.last_synced_at ?? null,
        task.id,
      ]
    );
  }

  async getTaskById(id: string): Promise<Task | null> {
    const row = await this.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
    return row ? this.mapRowToTask(row) : null;
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = await this.all(`SELECT * FROM tasks WHERE is_deleted = 0`);
    return rows.map(this.mapRowToTask);
  }

  // ---- Sync queue methods ----
  async addToSyncQueue(item: SyncQueueItem): Promise<void> {
    await this.run(
      `INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.task_id,
        item.operation,
        JSON.stringify(item.data),
        item.created_at ?? new Date().toISOString(),
        item.retry_count ?? 0,
        item.error_message ?? null,
      ]
    );
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    const rows = await this.all(`SELECT * FROM sync_queue`);
    return rows.map((row) => ({
      id: row.id,
      task_id: row.task_id,
      operation: row.operation,
      data: JSON.parse(row.data),
      created_at: row.created_at,
      retry_count: row.retry_count,
      error_message: row.error_message,
    }));
  }

  async clearSyncQueue(): Promise<void> {
    await this.run(`DELETE FROM sync_queue`);
  }

  // ---- Dead letter queue methods (NEW) ----
  async addToDeadLetterQueue(item: SyncQueueItem): Promise<void> {
    await this.run(
      `INSERT INTO dead_letter_queue (id, task_id, operation, data, created_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.task_id,
        item.operation,
        JSON.stringify(item.data),
        item.created_at ?? new Date().toISOString(),
        item.error_message ?? null,
      ]
    );
  }

  async getDeadLetterQueue(): Promise<SyncQueueItem[]> {
    const rows = await this.all(`SELECT * FROM dead_letter_queue`);
    return rows.map((row) => ({
      id: row.id,
      task_id: row.task_id,
      operation: row.operation,
      data: JSON.parse(row.data),
      created_at: row.created_at,
      retry_count: 3, // always failed after max retries
      error_message: row.error_message,
    }));
  }

  // ---- Helper mapper ----
  private mapRowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id,
      last_synced_at: row.last_synced_at,
    };
  }
}
