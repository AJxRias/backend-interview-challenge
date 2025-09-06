Backend Interview Challenge

This project implements a task management API with offline sync capabilities. It was built with Node.js, Express, TypeScript, SQLite, and follows a clear service-oriented design.

VIDEO:https://drive.google.com/drive/folders/1HeUFkTTMJ_18TGacI_zC5vDyVLTERSoy?usp=drive_link
🚀 Features

Task CRUD API

Create, update, delete, and fetch tasks

Soft delete support (is_deleted flag)

Sync Queue

Every operation is added to a local sync_queue for offline sync

Retry mechanism for failed syncs

Conflict Resolution

Implemented last-write-wins strategy for conflicts between local and server data

Robust Architecture

Separation of concerns (routes, services, db)

Clear types defined in src/types

Error handling middleware

📂 Project Structure
src/
├── db/
│   └── database.ts       # SQLite wrapper with task & sync queue helpers
├── middleware/
│   └── errorHandler.ts   # Centralized error handling
├── routes/
│   ├── tasks.ts          # REST API for tasks
│   └── sync.ts           # Endpoints for batch syncing
├── services/
│   ├── taskService.ts    # Business logic for tasks
│   └── syncService.ts    # Business logic for sync & conflict resolution
├── types/
│   └── index.ts          # Shared TypeScript types

⚙️ Workflow

Task Creation/Update/Delete

Task data is persisted in SQLite

A corresponding entry is created in the sync_queue

Sync Process

Items in sync_queue are processed and pushed to the server

If conflicts occur, the last-write-wins strategy resolves them

Conflict Resolution

If local and server versions differ:

The task with the latest updated_at timestamp is chosen as the winner

Other changes are discarded

🧩 Interesting Challenges & Problem Solving
1. Task Sync & Queue Management

Problem: Ensuring offline changes are not lost.

Approach: Introduced a sync_queue table with retry counters and error messages.

Benefit: Even if syncing fails, tasks remain queued until resolved.

2. Conflict Resolution Strategy

Problem: Handling cases where both client & server update a task.

Options Considered:

client-wins (always trust local)

server-wins (always trust server)

last-write-wins (trust the most recent update)

Decision: Implemented last-write-wins for fairness and data integrity.

3. TypeScript Type Errors

Problem: Inconsistent handling of Date fields (Date vs. string).

Approach: Standardized created_at and updated_at as Date objects everywhere.

4. ESLint & Type Checking Migration

Problem: ESLint v9 requires eslint.config.js instead of .eslintrc.

Approach: Migrated to the new format with @typescript-eslint/parser & plugin.

Lesson: Always check library migration guides when major versions change.

🛠️ Installation & Setup
# Install dependencies
npm install

# Run database migrations (if needed)
# npm run migrate

# Run dev server
npm run dev

# Lint & typecheck
npm run lint
npm run typecheck

🔑 Endpoints
Tasks

GET /tasks → Get all tasks

GET /tasks/:id → Get task by ID

POST /tasks → Create task

PUT /tasks/:id → Update task

DELETE /tasks/:id → Soft delete task

Sync

POST /sync → Sync single items

POST /sync/batch → Batch sync with conflict resolution

📖 Lessons Learned

Always define clear sync strategies early in system design

TypeScript catches subtle bugs (Date vs string, null handling)

ESLint/TSConfig setup is just as important as the app code for long-term maintainability

👉 This project demonstrates problem-solving in real-world backend challenges: offline data, syncing, conflicts, and strict typing.
