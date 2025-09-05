import axios from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  SyncQueueItem,
  SyncResult,
  SyncError,
  BatchSyncRequest,
  BatchSyncResponse,
  ConflictResolution,
} from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';

export class SyncService {
  private apiUrl: string;

  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
  }

  async sync(): Promise<SyncResult> {
    const pendingItems = await this.db.all(
      `SELECT * FROM sync_queue 
       WHERE status = 'pending' 
       ORDER BY task_id, created_at ASC`
    )as SyncQueueItem[];

    if (pendingItems.length === 0) {
      return { success: true, synced_items: 0, failed_items: 0, errors: [] };
    }

    try {
      const batchResponse = await this.processBatch(pendingItems);

      const synced = batchResponse.processed_items.filter(
        r => r.status === 'success'
      ).length;
      const failed = batchResponse.processed_items.filter(
        r => r.status === 'error'
      ).length;

      const errors: SyncError[] = batchResponse.processed_items
        .filter(r => r.status === 'error')
        .map(r => ({
          task_id: r.client_id,
          operation: pendingItems.find(i => i.id === r.client_id)?.operation || 'unknown',
          error: r.error || 'Unknown error',
          timestamp: new Date(),
        }));

      return { success: true, synced_items: synced, failed_items: failed, errors };
    } catch (err) {
      return {
        success: false,
        synced_items: 0,
        failed_items: pendingItems.length,
        errors: pendingItems.map(item => ({
          task_id: item.id,
          operation: item.operation,
          error: (err as Error).message,
          timestamp: new Date(),
        })),
      };
    }
  }

  async addToSyncQueue(
    taskId: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<Task>
  ): Promise<void> {
    const item: SyncQueueItem = {
      id: uuidv4(),
      task_id: taskId,
      operation,
      data,
      created_at: new Date(),
      retry_count: 0,
    };

    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count, error_message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.task_id,
        item.operation,
        JSON.stringify(item.data), // persist JSON as string
        item.created_at.toISOString(),
        item.retry_count,
        null,
        'pending',
      ]
    );
  }

  private async handleSyncError(
    item: SyncQueueItem,
    error: Error
  ): Promise<void> {
    const newRetryCount = (item.retry_count ?? 0) + 1;
    const maxRetries = 3;

    if (newRetryCount >= maxRetries) {
      // ✅ Move to dead letter queue
      await this.db.addToDeadLetterQueue({
        ...item,
        error_message: error.message,
        retry_count: newRetryCount,
      });

      // ✅ Remove from active sync_queue
      await this.db.run(`DELETE FROM sync_queue WHERE id = ?`, [item.id]);
    } else {
      // normal retry update
      await this.db.run(
        `UPDATE sync_queue
         SET retry_count = ?, error_message = ?, status = ?
         WHERE id = ?`,
        [
          newRetryCount,
          error.message,
          'pending',
          item.id,
        ]
      );
    }
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
     const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(items))
      .digest('hex');

     const batchRequest: BatchSyncRequest = {
      items,
      client_timestamp: new Date(),
      checksum,
    };

    const response = await axios.post<BatchSyncResponse>(
      `${this.apiUrl}/sync/batch`,
      batchRequest
    );

    for (const result of response.data.processed_items) {
      const item = items.find(i => i.id === result.client_id);
      if (!item) continue;

      if (result.status === 'success') {
        await this.db.run(
          `UPDATE sync_queue
           SET status = 'synced', error_message = NULL
           WHERE id = ?`,
          [item.id]
        );

        await this.taskService.updateTaskAfterSync(item.task_id, result.server_id);
      } else if (result.status === 'conflict' && result.resolved_data) {
        const resolution = await this.resolveConflict(
        JSON.parse(item.data as any) as Task,
        result.resolved_data,
        item.operation,
        result.operation || 'update' // fallback
       );

        await this.taskService.saveResolvedTask(resolution.resolved_task);

        await this.db.run(
          `UPDATE sync_queue
           SET status = 'synced'
           WHERE id = ?`,
          [item.id]
        );
      } else {
        await this.handleSyncError(item, new Error(result.error || 'Unknown error'));
      }
    }

    return response.data;
  }

 private async resolveConflict(
  localTask: Task,
  serverTask: Task,
  _localOp: 'create' | 'update' | 'delete',
  _serverOp: 'create' | 'update' | 'delete'
): Promise<ConflictResolution> {
  const localUpdated = new Date(localTask.updated_at);
  const serverUpdated = new Date(serverTask.updated_at);

  if (localUpdated.getTime() > serverUpdated.getTime()) {
    return { strategy: 'last-write-wins', resolved_task: localTask };
  } else if (serverUpdated.getTime() > localUpdated.getTime()) {
    return { strategy: 'last-write-wins', resolved_task: serverTask };
  } else {
    // tie → prefer server version
    return { strategy: 'last-write-wins', resolved_task: serverTask };
  }
}


  async checkConnectivity(): Promise<boolean> {
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
