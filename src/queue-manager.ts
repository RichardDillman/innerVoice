// Message Queue Manager for InnerVoice
// Stores messages for offline/inactive projects

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const QUEUE_DIR = path.join(process.env.HOME || '~', '.innervoice', 'queues');

export interface QueuedTask {
  id: string;
  projectName: string;
  projectPath: string;
  message: string;
  from: string;
  timestamp: Date;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'delivered' | 'expired';
}

// Ensure queue directory exists
async function ensureQueueDir(): Promise<void> {
  if (!existsSync(QUEUE_DIR)) {
    await fs.mkdir(QUEUE_DIR, { recursive: true });
  }
}

// Get queue file path for a project
function getQueuePath(projectName: string): string {
  const safeName = projectName.replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
  return path.join(QUEUE_DIR, `${safeName}.json`);
}

// Load queue for a project
export async function loadQueue(projectName: string): Promise<QueuedTask[]> {
  await ensureQueueDir();
  const queuePath = getQueuePath(projectName);

  if (!existsSync(queuePath)) {
    return [];
  }

  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    const tasks = JSON.parse(content);
    // Convert timestamp strings back to Date objects
    return tasks.map((t: any) => ({
      ...t,
      timestamp: new Date(t.timestamp)
    }));
  } catch (error) {
    console.error(`Error loading queue for ${projectName}:`, error);
    return [];
  }
}

// Save queue for a project
export async function saveQueue(projectName: string, tasks: QueuedTask[]): Promise<void> {
  await ensureQueueDir();
  const queuePath = getQueuePath(projectName);
  await fs.writeFile(queuePath, JSON.stringify(tasks, null, 2));
}

// Add a task to the queue
export async function enqueueTask(task: Omit<QueuedTask, 'id' | 'status'>): Promise<QueuedTask> {
  const queue = await loadQueue(task.projectName);

  const newTask: QueuedTask = {
    ...task,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending'
  };

  queue.push(newTask);
  await saveQueue(task.projectName, queue);

  console.log(`📥 Queued task for ${task.projectName}: ${task.message.substring(0, 50)}...`);
  return newTask;
}

// Get pending tasks for a project
export async function getPendingTasks(projectName: string): Promise<QueuedTask[]> {
  const queue = await loadQueue(projectName);
  return queue.filter(t => t.status === 'pending');
}

// Mark a task as delivered
export async function markTaskDelivered(projectName: string, taskId: string): Promise<void> {
  const queue = await loadQueue(projectName);
  const task = queue.find(t => t.id === taskId);

  if (task) {
    task.status = 'delivered';
    await saveQueue(projectName, queue);
    console.log(`✅ Task delivered: ${taskId}`);
  }
}

// Clear delivered tasks older than N days
export async function cleanupOldTasks(projectName: string, daysOld: number = 7): Promise<number> {
  const queue = await loadQueue(projectName);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const filtered = queue.filter(t => {
    if (t.status === 'delivered' && t.timestamp < cutoff) {
      return false; // Remove old delivered tasks
    }
    return true;
  });

  const removed = queue.length - filtered.length;
  if (removed > 0) {
    await saveQueue(projectName, filtered);
    console.log(`🧹 Cleaned up ${removed} old tasks for ${projectName}`);
  }

  return removed;
}

// List all projects with queued tasks
export async function listProjectsWithQueues(): Promise<string[]> {
  await ensureQueueDir();
  const files = await fs.readdir(QUEUE_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', '').replace(/_/g, '-'));
}

// Get queue summary for all projects
export async function getQueueSummary(): Promise<{ projectName: string; pending: number; total: number }[]> {
  const projects = await listProjectsWithQueues();
  const summaries = await Promise.all(
    projects.map(async (projectName) => {
      const queue = await loadQueue(projectName);
      return {
        projectName,
        pending: queue.filter(t => t.status === 'pending').length,
        total: queue.length
      };
    })
  );

  return summaries.filter(s => s.total > 0);
}
