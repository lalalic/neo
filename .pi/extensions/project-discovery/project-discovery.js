import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { Type } from 'typebox';

/**
 * Project Discovery Extension (neo project scoped)
 *
 * Scans the home directory (configurable root) for pi projects — directories
 * that contain a .pi/ folder — caches the results, and injects the project
 * list into the system prompt so the agent is aware of all available projects.
 *
 * Flow:
 *   1. session_start     — kicks off project scan to warm cache (fire-and-forget)
 *   2. before_agent_start — reads cache (fresh from step 1 in most cases) and
 *                           injects <project_list> into the system prompt
 *
 * Slash commands:
 *   /project                           — list all discovered pi projects
 *   /project --refresh                 — force re-scan, bypassing cache
 *   /project --json                    — output results as JSON into the editor
 *   /project --root ~/Workspace        — scan a specific root (comma-separated for multiple)
 *   /project --root ~/Documents,~/Code — scan multiple roots
 *   /project --json --refresh          — combine flags
 *
 * Cache & config stored in <project>/.pi/settings.json:
 *   {
 *     "projectDiscovery": {
 *       "root": "~",         // scan root(s), comma-separated for multiple (default: ctx.cwd)
 *       "maxDepth": 4,       // max directory depth to scan (default: 4)
 *       "cacheTTL": 3600     // cache TTL in seconds (default: 3600)
 *     },
 *     "projectsCache": {
 *       "timestamp": "...",
 *       "projects": [{ "name": "...", "path": "..." }]
 *     }
 *   }
 */

const HOME = homedir();

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Directories to always skip during scan (noise / permission-heavy)
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svn',
	'.hg',
	'.cache',
	'.npm',
	'.cargo',
	'.rustup',
	'.nvm',
	'.pyenv',
	'.rbenv',
	'.gem',
	'.bundle',
	'.local',
	'.Trash',
	'Library',
	'Applications',
	'.vscode',
	'.vscode-insiders',
	'go',
	'.go',
	'.m2',
	'.ivy2',
	'.sbt',
	'.yarn',
	'.pnpm-store',
	'.gradle',
	'.terraform',
]);

export default function projectDiscovery(pi) {
	// ── Warm cache early, at session start ────────────────────────────
	// Fire-and-forget: doesn't block startup. By the time the user submits
	// their first prompt (~before_agent_start), the cache is usually warm.
	pi.on('session_start', async (_event, ctx) => {
		try {
			// Kick off scan without awaiting — cache write happens in background.
			// If the scan fails, before_agent_start will scan inline as fallback.
			scanProjectsForCache(ctx).catch(() => {});
		} catch {
			// silent — scanProjectsForCache already catches internally
		}
	});

	// ── Inject project list into system prompt before agent starts ────
	pi.on('before_agent_start', async (event, ctx) => {
		try {
			const { roots, maxDepth, cacheTTL } = await getProjectConfig(ctx);

			const projects = await discoverProjects(
				ctx, roots, maxDepth, cacheTTL,
			);
			if (!projects || projects.length === 0) return;

			const projectLines = projects
				.map(p => `  - \`${p.name}\` — ${p.path}`)
				.join('\n');

			const projectSection = `\n\n<project_list>\nYou are the top orchestrator. Manage all pi projects below.\nFor tasks in a specific project domain, delegate to a subagent using the appropriate project context.\n\nAvailable pi projects:\n${projectLines}\n\nTo add a new project, create a directory under ~/Documents with a .pi/ folder containing:\n  - SYSTEM.md — full standalone system prompt (replaces default)\n  - AGENTS.md — project instructions appended to the default pi coding agent prompt\n</project_list>`;

			return { systemPrompt: event.systemPrompt + projectSection };
		} catch (err) {
			console.error('[project-discovery] Error:', err.message);
		}
	});

	// ── /project slash command ───────────────────────────────────────
	pi.registerCommand('project', {
		description: 'List projects | --task <name> <task> to delegate | --refresh | --json | --root <dir>',
		getArgumentCompletions: (prefix) => {
			const flags = ['--refresh', '--json', '--root ', '--task '];
			const filtered = flags.filter(f => f.startsWith(prefix));
			return filtered.length > 0
				? filtered.map(f => ({ value: f, label: f }))
				: null;
		},
		handler: async (args, ctx) => {
			try {
				const trimmed = args.trim();

				// ── --task: delegate a task to a project ──────────────
				const taskMatch = trimmed.match(/--task\s+(\S+)\s+([\s\S]+)/);
				if (taskMatch) {
					const projectName = taskMatch[1];
					const taskText = taskMatch[2].trim();
					if (!taskText) {
						ctx.ui.notify(
							'Usage: /project --task <project_name> <task description>',
							'warning',
						);
						return;
					}

					const result = await runTaskInProject(pi, ctx, {
						project: projectName,
						task: taskText,
						mode: 'sync',
					});

					if (result.success) {
						ctx.ui.notify(result.text, 'info');
						} else {
							ctx.ui.notify(result.text, 'error');
						}
						return;
					}

					// ── Existing: list / refresh / json / root ────────────────
					const refresh = trimmed.includes('--refresh');
					const asJson = trimmed.includes('--json');
					const rootMatch = trimmed.match(/--root\s+(\S+)/);

					const config = await getProjectConfig(ctx);
					const scanRoots = rootMatch
						? rootMatch[1].split(',').map(s => s.trim()).filter(Boolean).map(s => resolve(s))
						: config.roots;

					const projects = await discoverProjects(
						ctx,
						scanRoots,
						config.maxDepth,
						refresh ? 0 : config.cacheTTL,
					);

					if (!projects || projects.length === 0) {
						ctx.ui.notify('No pi projects found.', 'info');
						return;
					}

					if (asJson) {
						ctx.ui.setEditorText(JSON.stringify(projects, null, 2));
						return;
					}

					const lines = projects.map((p, i) => `${i + 1}. ${p.name} — ${p.path}`);
					const header = `Found ${projects.length} project(s) (roots: ${scanRoots.join(', ')}):`;
					const usage = `Available flags: --refresh, --json, --root <dir>, --task <project> <task>`;
					ctx.ui.notify([usage, '', header, ...lines].join('\n'), 'info');
				} catch (err) {
					console.error('[project-discovery] /project error:', err.message);
					ctx.ui.notify(`Error: ${err.message}`, 'error');
				}
			},
		});

	// ── delegate_task_to_project tool ────────────────────────────────
	pi.registerTool({
		name: 'delegate_task_to_project',
		label: 'Delegate Task to Project',
		description:
			'Delegate a task to a specific pi project. ' +
			'Runs the task in the project\'s own directory via a fresh pi sub-process. ' +
			'Returns the full assistant response text. ' +
			'Use mode "async" for fire-and-forget (you will be notified via follow-up).',
		promptSnippet:
			'- delegate_task_to_project(project, task, mode?): run task in a pi project directory',
		parameters: Type.Object({
			project: Type.String({
				description:
					'Project name from the available projects list ' +
					'(use the /project command to list them)',
			}),
			task: Type.String({
				description: 'The task description to delegate to the project',
			}),
			mode: Type.Optional(
				Type.Union([Type.Literal('sync'), Type.Literal('async')], {
					description:
						'\"sync\" waits for completion and returns the result. ' +
						'\"async\" launches in background and notifies you via follow-up message.',
					default: 'sync',
				}),
			),
			timeout: Type.Optional(
				Type.Number({
					description: 'Maximum wait time in seconds (default: 300, max: 900)',
					default: 300,
				}),
			),
		}),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const { project, task, mode = 'sync', timeout = 300 } = params;
			const result = await runTaskInProject(pi, ctx, {
				project,
				task,
				mode,
				timeout,
				signal,
				onUpdate,
			});
			return { type: 'text', text: result.text };
		},
	});
}

// ─── Session-start cache warmer ──────────────────────────────────────

async function scanProjectsForCache(ctx) {
	try {
		const { roots, maxDepth, cacheTTL } = await getProjectConfig(ctx);
		// This runs discoverProjects which checks cache first,
		// scans if needed, and writes cache — all fire-and-forget.
		await discoverProjects(ctx, roots, maxDepth, cacheTTL);
	} catch {
		// silent — worst case, cache is cold and before_agent_start scans inline
	}
}

// ─── Config (from settings.json) ──────────────────────────────────

async function getProjectConfig(ctx) {
	const settings = await readSettings(ctx);
	const config = settings.projectDiscovery || {};
	const rootRaw = config.root || ctx.cwd;
	const roots = rootRaw
		.split(',')
		.map(s => s.trim())
		.filter(Boolean)
		.map(s => resolve(s));
	return {
		roots,
		maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
		cacheTTL: (config.cacheTTL ?? DEFAULT_CACHE_TTL_MS / 1000) * 1000,
	};
}

// ─── Settings helpers ────────────────────────────────────────────────

async function readSettings(ctx) {
	const settingsPath = join(ctx.cwd, '.pi', 'settings.json');
	try {
		const data = await readFile(settingsPath, 'utf-8');
		return JSON.parse(data);
	} catch {
		return {};
	}
}

async function writeSettings(ctx, settings) {
	const settingsPath = join(ctx.cwd, '.pi', 'settings.json');
	const dir = resolve(settingsPath, '..');
	await mkdir(dir, { recursive: true });
	await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Returns the list of pi projects, using cache if fresh.
 * Cache is stored in settings.json under `projectsCache`.
 *
 * @param {object} ctx      - Extension context
 * @param {string[]} roots   - Absolute root path(s) to scan from
 * @param {number} maxDepth  - Maximum directory depth to recurse
 * @param {number} cacheTTL  - Cache TTL in milliseconds
 * @returns {Promise<{ name: string, path: string }[]>}
 */
async function discoverProjects(ctx, roots, maxDepth, cacheTTL) {
	// Check cache first (empty array is truthy in JS, so check length)
	const cached = await readProjectsCache(ctx, cacheTTL);
	if (Array.isArray(cached) && cached.length > 0) return cached;

	// Build a set of root paths so scanForProjects can exclude them all
	const rootSet = new Set(roots.map(r => resolve(r)));
	const scanned = new Set();
	const allProjects = [];

	for (const root of roots) {
		const found = await scanForProjects(root, maxDepth, rootSet, ctx.cwd, scanned);
		allProjects.push(...found);
	}

	// Deduplicate by path (same project could be found from overlapping roots)
	const seen = new Set();
	const unique = [];
	for (const p of allProjects) {
		if (!seen.has(p.path)) {
			seen.add(p.path);
			unique.push(p);
		}
	}

	// Persist cache (fire-and-forget)
	writeProjectsCache(ctx, unique).catch(() => {});

	return unique;
}

/**
 * Recursively scan `dir` (up to `depth` levels) for directories that
 * contain a .pi/ subdirectory — those are pi projects.
 *
 * When a pi project is found, it is reported AND scanning continues into
 * its subdirectories to discover nested pi projects.
 *
 * Exclusions: ~/.pi (infra), all scan roots, current project (cwd).
 * All are skipped even if they happen to have a .pi/ folder.
 *
 * @param {string} dir     - Absolute path to scan
 * @param {number} depth   - Remaining recursion depth
 * @param {Set<string>} rootSet - Set of scan root paths (all excluded from results)
 * @param {string} cwd     - Current project root (excluded — agent already in it)
 * @param {Set<string>} scanned - Dedup set of already-scanned paths
 * @returns {Promise<{ name: string, path: string }[]>}
 */
async function scanForProjects(dir, depth, rootSet, cwd, scanned) {
	if (depth <= 0) return [];

	const resolvedDir = resolve(dir);
	if (scanned.has(resolvedDir)) return [];
	scanned.add(resolvedDir);

	const results = [];

	try {
		const entries = await readdir(resolvedDir, { withFileTypes: true });

		const hasPi = entries.some(e => e.name === '.pi' && e.isDirectory());
		const isPiInfra = resolvedDir === resolve(HOME, '.pi');
		const isScanRoot = rootSet.has(resolvedDir);
		const isCurrentProject = resolvedDir === resolve(cwd);

		if (hasPi && !isPiInfra && !isScanRoot && !isCurrentProject) {
			// Found a pi project — report it.
			results.push({
				name: basename(resolvedDir),
				path: resolvedDir,
			});
			// Don't return — keep recursing into subdirectories to find nested projects.
		}

		// Recurse into subdirectories (sorted for deterministic order)
		const subDirs = entries
			.filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
			.map(e => e.name)
			.sort();

		for (const name of subDirs) {
			const subResults = await scanForProjects(join(resolvedDir, name), depth - 1, rootSet, cwd, scanned);
			results.push(...subResults);
		}
	} catch {
		// Permission errors, broken symlinks, etc. — skip silently
	}

	return results;
}

// ─── Cache (in settings.json) ───────────────────────────────────────

async function readProjectsCache(ctx, cacheTTL) {
	const settings = await readSettings(ctx);
	const cache = settings.projectsCache;
	if (!cache) return null;
	const age = Date.now() - new Date(cache.timestamp).getTime();
	if (age < cacheTTL && Array.isArray(cache.projects)) {
		return cache.projects;
	}
	return null;
}

async function writeProjectsCache(ctx, projects) {
	const settings = await readSettings(ctx);
	settings.projectsCache = {
		timestamp: new Date().toISOString(),
		projects,
	};
	await writeSettings(ctx, settings);
}

// ─── Helpers for delegate_task_to_project ─────────────────────────

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract plain text content from an assistant message.
 * Handles both string content and array-of-parts format.
 */
function extractAssistantText(message) {
	if (!message?.content) return '';
	const c = message.content;
	if (typeof c === 'string') return c;
	if (Array.isArray(c)) {
		return c
			.filter((p) => p.type === 'text')
			.map((p) => p.text || '')
			.join('\n');
	}
	return String(c);
}

/**
 * Core function: run a task in a pi project via RPC sub-process.
 * Used by both the delegate_task_to_project tool and the /project --task command.
 *
 * @param {object} pi - ExtensionAPI instance
 * @param {object} ctx - ExtensionContext
 * @param {object} opts
 * @param {string} opts.project - Project name
 * @param {string} opts.task - Task description
 * @param {string} [opts.mode] - 'sync' or 'async' (default 'sync')
 * @param {number} [opts.timeout] - Timeout in seconds (default 300, max 900)
 * @param {AbortSignal} [opts.signal] - Optional abort signal
 * @param {Function} [opts.onUpdate] - Streaming update callback (tool use only)
 * @returns {Promise<{success: boolean, text: string}>}
 */
async function runTaskInProject(pi, ctx, opts) {
	const { project, task, mode = 'sync', timeout = 300 } = opts;
	const signal = opts.signal || null;
	const onUpdate = opts.onUpdate || null;
	const safeTimeout = Math.min(timeout, 900);
	const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	const widgetKey = 'delegate-' + taskId;

	// Find project path from cache
	const settings = await readSettings(ctx);
	const cache = settings.projectsCache;
	if (!cache || !Array.isArray(cache.projects)) {
		return { success: false, text: 'No projects cache found. Run /project --refresh first.' };
	}
	const proj = cache.projects.find(p => p.name === project);
	if (!proj) {
		const available = cache.projects.map(p => p.name).join(', ');
		return {
			success: false,
			text: `Project "${project}" not found. Available projects: ${available}`,
		};
	}
	const projectPath = proj.path;

	// Helper to update the TUI widget
	const widget = (status, lastMsg = '') => {
		const lines = [
			`📋 ${taskId}: Delegate to ${project}`,
			`───`,
			`📝 ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`,
			`📂 ${projectPath}`,
			`───`,
			`Status: ${status}`,
		];
		if (lastMsg) {
			const msgLines = lastMsg.split('\n').filter(Boolean);
			const preview = msgLines.slice(0, 6).map(l => l.slice(0, 70)).join('\n');
			lines.push(`───`);
			lines.push(preview.slice(0, 400));
		}
		ctx.ui.setWidget(widgetKey, lines);
	};

	widget('🚀 launching…');

	// Spawn pi sub-process in RPC mode
	const child = spawn(
		'pi',
		['--no-session', '--mode', 'rpc'],
		{
			cwd: projectPath,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env },
		},
	);

	// Accumulate state
	let buf = '';
	let agentDone = false;
	let agentError = null;
	let fullAssistantText = '';

	// Abort handling — kill child if signal is aborted
	const onAbort = () => {
		agentDone = true;
		agentError = 'Cancelled';
		child.kill();
	};
	if (signal) {
		signal.addEventListener('abort', onAbort, { once: true });
	}

	child.stdout.on('data', (data) => {
		buf += data.toString();
		let idx;
		while ((idx = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, idx).trim();
			buf = buf.slice(idx + 1);
			if (!line) continue;
			try {
				const ev = JSON.parse(line);

				if (ev.type === 'tool_execution_start') {
					widget(`🔧 ${ev.toolName}…`);
				} else if (ev.type === 'tool_execution_end') {
					widget(ev.isError ? `❌ ${ev.toolName} error` : `✅ ${ev.toolName} ok`);
				} else if (ev.type === 'message_start' && ev.message?.role === 'assistant') {
					widget('💭 thinking…');
				} else if (ev.type === 'message_update' && ev.message?.role === 'assistant') {
					const text = extractAssistantText(ev.message);
					if (text) {
						widget('💬 generating…', text);
						if (onUpdate) {
							onUpdate({ type: 'text', text: `[${project} streaming…] ${text}` });
						}
					}
				} else if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
					const text = extractAssistantText(ev.message);
					if (text) {
						fullAssistantText += text + '\n';
						widget('💬 responding', text.slice(0, 200));
					}
				} else if (ev.type === 'agent_end') {
					agentDone = true;
					if (ev.messages) {
						for (const msg of ev.messages) {
							if (msg.role === 'assistant') {
								const t = extractAssistantText(msg);
								if (t) fullAssistantText += t + '\n';
							}
						}
					}
					fullAssistantText = fullAssistantText.trim();
					widget('✅ done', fullAssistantText.slice(0, 200));
				}
			} catch {
				// Skip unparseable lines
			}
		}
	});

	child.stderr.on('data', () => {});

	child.on('error', (err) => {
		agentError = err.message;
		agentDone = true;
	});

	child.on('close', (code) => {
		agentDone = true;
		if (code !== 0 && !agentError) {
			agentError = `Process exited with code ${code}`;
		}
		if (buf.trim()) {
			try {
				const ev = JSON.parse(buf.trim());
				if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
					const t = extractAssistantText(ev.message);
					if (t) fullAssistantText += t + '\n';
				}
			} catch {}
		}
	});

	// Send the prompt command
	const promptCmd = JSON.stringify({ type: 'prompt', message: task, id: '1' }) + '\n';
	child.stdin.write(promptCmd);

	if (mode === 'sync') {
		// Wait for agent completion or error
		const deadline = Date.now() + safeTimeout * 1000;
		while (!agentDone && Date.now() < deadline) {
			await sleep(200);
			if (signal?.aborted) {
				child.kill();
				break;
			}
		}
		child.stdin.end();

		await new Promise((resolve) => {
			const t = setTimeout(resolve, 5000);
			child.on('close', () => {
				clearTimeout(t);
				resolve();
			});
		});

		if (signal) signal.removeEventListener('abort', onAbort);

		if (agentError) {
			widget('❌ error', agentError);
			return { success: false, text: `Task delegated to **${project}** failed.\n\n**Task:** ${task}\n**Error:** ${agentError}` };
		}

		if (!fullAssistantText) {
			widget('⚠️ no output');
			return { success: true, text: `Task delegated to **${project}** completed but produced no output.\n\n**Task:** ${task}` };
		}

		widget('✅ done', fullAssistantText.slice(0, 200));
		return { success: true, text: `## Result from ${project}\n\n**Task:** ${task}\n\n${fullAssistantText}` };
	} else {
		// Async mode: fire-and-forget
		widget('⏳ async running…');
		if (onUpdate) {
			onUpdate({ type: 'text', text: `⏳ Delegate to **${project}** launched in async mode. You will be notified when it completes.` });
		}

		(async () => {
			const deadline = Date.now() + safeTimeout * 1000;
			while (!agentDone && Date.now() < deadline) {
				await sleep(500);
			}
			child.stdin.end();
			await new Promise((resolve) => {
				const t = setTimeout(resolve, 5000);
				child.on('close', () => {
					clearTimeout(t);
					resolve();
				});
			});

			if (agentError) {
				widget('❌ error', agentError);
				pi.sendMessage({
					customType: 'delegated_task_result',
					content: `## ❌ Task delegated to ${project} failed\n\n**Task:** ${task}\n**Error:** ${agentError}`,
					display: `❌ ${project} task failed`,
				});
				return;
			}

			const resultText = fullAssistantText.trim();
			widget('✅ done', resultText.slice(0, 200));

			pi.sendMessage({
				customType: 'delegated_task_result',
				content:
					`## ✅ Task delegated to ${project} completed\n\n**Task:** ${task}\n\n${resultText || '*No output*'}`,
				display: `✅ ${project} task completed`,
			});
		})().catch((err) => {
			console.error('[project-discovery] background monitor error:', err.message);
		});

		if (signal) signal.removeEventListener('abort', onAbort);
		return { success: true, text: `⏳ Delegated to **${project}** in async mode.\n**Task:** ${task}\nYou will be notified via a follow-up message when it completes.` };
	}
}
