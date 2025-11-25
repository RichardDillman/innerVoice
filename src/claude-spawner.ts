// Claude Spawner for InnerVoice
// Spawns Claude Code instances remotely from Telegram

import { spawn, ChildProcess } from 'child_process';
import { findProject, touchProject } from './project-registry.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env file from a directory and return as object
function loadEnvFile(dirPath: string): Record<string, string> {
  const envPath = join(dirPath, '.env');
  const envVars: Record<string, string> = {};

  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          envVars[key] = value;
        }
      }
      console.log(`[SPAWN] Loaded ${Object.keys(envVars).length} env vars from ${envPath}`);
    } catch (error) {
      console.error(`[SPAWN] Failed to load .env from ${envPath}:`, error);
    }
  }

  return envVars;
}

interface SpawnedProcess {
  projectName: string;
  process: ChildProcess;
  startTime: Date;
  initialPrompt?: string;
  onOutput?: (data: string, isError: boolean) => void;
}

const activeProcesses = new Map<string, SpawnedProcess>();

// Spawn Claude in a project
export async function spawnClaude(
  projectName: string,
  initialPrompt?: string,
  onOutput?: (data: string, isError: boolean) => void
): Promise<{ success: boolean; message: string; pid?: number }> {
  // Check if already running
  if (activeProcesses.has(projectName)) {
    return {
      success: false,
      message: `Claude is already running in ${projectName}`
    };
  }

  // Find project in registry
  const project = await findProject(projectName);
  if (!project) {
    return {
      success: false,
      message: `Project "${projectName}" not found in registry. Register it first with: /register ProjectName /path/to/project`
    };
  }

  try {
    // Load project's .env file to pass to Claude
    const projectEnv = loadEnvFile(project.path);

    // Spawn Claude Code
    const claudeProcess = spawn('claude', initialPrompt ? [initialPrompt] : [], {
      cwd: project.path,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        ...projectEnv, // Include project's .env variables
        INNERVOICE_SPAWNED: '1' // Mark as spawned by InnerVoice
      }
    });

    // Store process
    activeProcesses.set(projectName, {
      projectName,
      process: claudeProcess,
      startTime: new Date(),
      initialPrompt,
      onOutput
    });

    // Update last accessed
    await touchProject(projectName);

    // Handle output - log and optionally send to callback
    if (claudeProcess.stdout) {
      claudeProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[${projectName}] ${output}`);

        // Send to callback if provided
        if (onOutput) {
          console.log(`[DEBUG] Invoking onOutput callback for stdout in ${projectName}`);
          try {
            onOutput(output, false);
          } catch (error) {
            console.error(`[ERROR] onOutput callback failed for ${projectName}:`, error);
          }
        } else {
          console.warn(`[WARN] No onOutput callback provided for ${projectName}`);
        }
      });
    }

    if (claudeProcess.stderr) {
      claudeProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        console.error(`[${projectName}] ${output}`);

        // Send errors to callback if provided
        if (onOutput) {
          console.log(`[DEBUG] Invoking onOutput callback for stderr in ${projectName}`);
          try {
            onOutput(output, true);
          } catch (error) {
            console.error(`[ERROR] onOutput callback failed for ${projectName}:`, error);
          }
        }
      });
    }

    // Handle exit
    claudeProcess.on('exit', (code) => {
      console.log(`🛑 Claude exited in ${projectName} (code: ${code})`);
      activeProcesses.delete(projectName);
    });

    claudeProcess.on('error', (error) => {
      console.error(`❌ Error spawning Claude in ${projectName}:`, error);
      activeProcesses.delete(projectName);
    });

    // Unref so it doesn't keep Node running
    claudeProcess.unref();

    return {
      success: true,
      message: `✅ Claude started in ${projectName}${initialPrompt ? ` with prompt: "${initialPrompt}"` : ''}`,
      pid: claudeProcess.pid
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to spawn Claude: ${error.message}`
    };
  }
}

// Kill a spawned Claude process
export function killClaude(projectName: string): { success: boolean; message: string } {
  const spawned = activeProcesses.get(projectName);

  if (!spawned) {
    return {
      success: false,
      message: `No active Claude process found for ${projectName}`
    };
  }

  try {
    spawned.process.kill('SIGTERM');
    activeProcesses.delete(projectName);
    return {
      success: true,
      message: `✅ Claude process terminated in ${projectName}`
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to kill process: ${error.message}`
    };
  }
}

// List all spawned processes
export function listSpawnedProcesses(): Array<{
  projectName: string;
  pid?: number;
  startTime: Date;
  initialPrompt?: string;
  runningMinutes: number;
}> {
  return Array.from(activeProcesses.values()).map(sp => ({
    projectName: sp.projectName,
    pid: sp.process.pid,
    startTime: sp.startTime,
    initialPrompt: sp.initialPrompt,
    runningMinutes: Math.floor((Date.now() - sp.startTime.getTime()) / 60000)
  }));
}

// Check if Claude is running in a project
export function isClaudeRunning(projectName: string): boolean {
  return activeProcesses.has(projectName);
}
