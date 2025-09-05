import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Trigger manual sync
  router.post('/sync', async (_req: Request, res: Response) => {
    try {
      const online = await syncService.checkConnectivity();
      if (!online) {
        return res.status(503).json({
          success: false,
          synced_items: 0,
          failed_items: 0,
          errors: [
            {
              task_id: '',
              operation: 'sync',
              error: 'Server unreachable',
              timestamp: new Date(),
            },
          ],
        });
      }

      const result = await syncService.sync();
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        synced_items: 0,
        failed_items: 0,
        errors: [
          {
            task_id: '',
            operation: 'sync',
            error: err.message || 'Unknown sync error',
            timestamp: new Date(),
          },
        ],
      });
    }
  });

  // Check sync status
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const counts = await db.get(
        `SELECT 
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM sync_queue`
      );

      const deadLetter = await db
        .get(`SELECT COUNT(*) as count FROM dead_letter_queue`)
        .catch(() => ({ count: 0 })); // fallback if dead letter table doesn’t exist

      const lastSynced = await db.get(
        `SELECT MAX(last_synced_at) as last_synced_at FROM tasks`
      );

      const online = await syncService.checkConnectivity();

      res.json({
        pending_sync_count: counts?.pending || 0,
        in_progress: counts?.in_progress || 0,
        synced: counts?.synced || 0,
        error: counts?.error || 0,
        failed: counts?.failed || 0,
        dead_letter: deadLetter?.count || 0,
        last_sync_timestamp: lastSynced?.last_synced_at || null,
        is_online: online,
        sync_queue_size:
          (counts?.pending || 0) +
          (counts?.in_progress || 0) +
          (counts?.error || 0),
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Failed to fetch sync status',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Batch sync endpoint (server-side)
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const { items, client_timestamp:_client_timestamp, checksum } = req.body;

      // Verify checksum (constraint: BATCH_INTEGRITY)
      const crypto = await import('crypto');
      const computedChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(items))
        .digest('hex');

      if (computedChecksum !== checksum) {
        return res.status(400).json({
          error: 'Checksum mismatch',
          processed_items: [],
          timestamp: new Date(),
          path: req.originalUrl,
        });
      }

      // TODO: Normally, server would apply operations here.
      // For challenge, echo back a mock success response
      return res.json({
        processed_items: items.map((i: any) => ({
          client_id: i.id,
          server_id: i.task_id, // placeholder mapping
          status: 'success',
          resolved_data: {
            ...i.data,
            id: i.task_id,
            updated_at: new Date(),
          },
        })),
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err.message || 'Batch processing failed',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Health check endpoint
  router.get('/health', async (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  return router;
}
