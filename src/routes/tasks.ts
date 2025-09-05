import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { SyncService } from '../services/syncService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Get all tasks
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tasks = await taskService.getAllTasks();
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({
        error: error.message || 'Failed to fetch tasks',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Get single task
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({
          error: 'Task not found',
          timestamp: new Date(),
          path: req.originalUrl,
        });
      }
      return res.json(task);
    } catch (error: any) {
      return res.status(500).json({
        error: error.message || 'Failed to fetch task',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Create task
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { title, description } = req.body;
      if (!title) {
        return res.status(400).json({
          error: 'Title is required',
          timestamp: new Date(),
          path: req.originalUrl,
        });
      }

      const task = await taskService.createTask({
        title,
        description: description || '',
        completed: false,
        updated_at: new Date(),
      });

      // Add to sync queue
      await syncService.addToSyncQueue(task.id, 'create', task);

      return res.status(201).json(task);
    } catch (error: any) {
      return res.status(500).json({
        error: error.message || 'Failed to create task',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Update task
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const existing = await taskService.getTask(req.params.id);
      if (!existing) {
        return res.status(404).json({
          error: 'Task not found',
          timestamp: new Date(),
          path: req.originalUrl,
        });
      }

      const updated = await taskService.updateTask(req.params.id, {
        ...req.body,
        updated_at: new Date().toISOString(),
      });

      // Add to sync queue
      await syncService.addToSyncQueue(req.params.id, 'update', updated!);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({
        error: error.message || 'Failed to update task',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  // Delete task
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await taskService.deleteTask(req.params.id);
      if (!deleted) {
        return res.status(404).json({
          error: 'Task not found',
          timestamp: new Date(),
          path: req.originalUrl,
        });
      }

      // Add to sync queue
      await syncService.addToSyncQueue(req.params.id, 'delete', {});

      return res.json({ success: true, timestamp: new Date() });
    } catch (error: any) {
      return res.status(500).json({
        error: error.message || 'Failed to delete task',
        timestamp: new Date(),
        path: req.originalUrl,
      });
    }
  });

  return router;
}
