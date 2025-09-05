import { v4 as uuidv4 } from "uuid";
import { Task } from "../types";
import { Database } from "../db/database";

export class TaskService {
  constructor(private db: Database) {}

  // Create a new task and add it to sync queue
  async createTask(data: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: data.id ?? uuidv4(),
      title: data.title ?? "Untitled Task",
      description: data.description ?? undefined,
      completed: data.completed ?? false,
      created_at: new Date(),
      updated_at: new Date(),
      is_deleted: false,
      sync_status: "pending",
      server_id: undefined,
      last_synced_at: undefined,
    };

    // Save to database
    await this.db.insertTask(task);

    // Add to sync queue
    await this.db.addToSyncQueue({
      id: uuidv4(),
      task_id: task.id,
      operation: "create",
      data: task,
      created_at: new Date(),
      retry_count: 0,
      error_message: undefined,
    });

    return task;
  }

  // Update task
  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existing = await this.db.getTaskById(id);
    if (!existing) return null;

    const updated: Task = {
      ...existing,
      ...updates,
      updated_at: new Date(),
      sync_status: "pending",
    };

    await this.db.updateTask(updated);

    await this.db.addToSyncQueue({
      id: uuidv4(),
      task_id: updated.id,
      operation: "update",
      data: updated,
      created_at: new Date(),
      retry_count: 0,
      error_message: undefined,
    });

    return updated;
  }

  // Delete task (soft delete)
  async deleteTask(id: string): Promise<boolean> {
    const existing = await this.db.getTaskById(id);
    if (!existing) return false;

    const deleted: Task = {
      ...existing,
      is_deleted: true,
      updated_at: new Date(),
      sync_status: "pending",
    };

    await this.db.updateTask(deleted);

    await this.db.addToSyncQueue({
      id: uuidv4(),
      task_id: deleted.id,
      operation: "delete",
      data: deleted,
      created_at: new Date(),
      retry_count: 0,
      error_message: undefined,
    });

    return true;
  }

  // Get single task by id
  async getTask(id: string): Promise<Task | null> {
    const task = await this.db.getTaskById(id);
    if (!task || task.is_deleted) {
      return null;
    }
    return task;
  }

  // Get all active tasks
  async getAllTasks(): Promise<Task[]> {
    return await this.db.getAllTasks();
  }

  // Tasks that still need syncing
  async getTasksNeedingSync(): Promise<Task[]> {
    const tasks = await this.db.getAllTasks();
    return tasks.filter(
      (t) => t.sync_status === "pending" || t.sync_status === "error"
    );
  }

  // ✅ Called after a successful sync with server
  async updateTaskAfterSync(taskId: string, serverId: string): Promise<void> {
    const task = await this.db.getTaskById(taskId);
    if (!task) return;

    const syncedTask: Task = {
      ...task,
      server_id: serverId,
      sync_status: "synced",
      last_synced_at: new Date(),
      
    };

    await this.db.updateTask(syncedTask);
  }

  // ✅ Called after resolving conflicts (server vs local)
  async saveResolvedTask(resolvedTask: Task): Promise<void> {
    const finalTask: Task = {
      ...resolvedTask,
      sync_status: "synced",
      last_synced_at: new Date(),
    };

    await this.db.updateTask(finalTask);
  }
}
