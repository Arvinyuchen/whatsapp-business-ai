import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const schemaVersion = 1;

function metricsFrom(workspace) {
  const workflows = {};
  const automationOutcomes = {};
  for (const conversation of workspace.conversations) {
    workflows[conversation.workflow] = (workflows[conversation.workflow] || 0) + 1;
  }
  for (const audit of workspace.audits) {
    if (audit.type !== 'automation.decision') continue;
    automationOutcomes[audit.outcome] = (automationOutcomes[audit.outcome] || 0) + 1;
  }
  return {
    events: workspace.events.length,
    conversations: workspace.conversations.length,
    audits: workspace.audits.length,
    workflows,
    automationOutcomes
  };
}

export function verifyWorkspaceExport(payload) {
  const errors = [];
  if (payload?.schemaVersion !== schemaVersion) errors.push('Unsupported schema version.');
  if (!payload?.exportedAt || !Number.isFinite(Date.parse(payload.exportedAt))) {
    errors.push('Missing or invalid export timestamp.');
  }
  for (const field of ['events', 'conversations', 'audits']) {
    if (!Array.isArray(payload?.workspace?.[field])) errors.push(`Workspace ${field} must be an array.`);
  }
  const conversationIds = (payload?.workspace?.conversations || []).map(({ id }) => id);
  if (new Set(conversationIds).size !== conversationIds.length) {
    errors.push('Conversation IDs must be unique.');
  }
  const auditIds = (payload?.workspace?.audits || []).map(({ id }) => id);
  if (new Set(auditIds).size !== auditIds.length) errors.push('Audit IDs must be unique.');
  return { valid: errors.length === 0, errors };
}

export function createWorkspaceOperations({
  workspaceStore,
  backupDirectory,
  retentionDays = 90,
  eventLimit = 500,
  auditLimit = 1_000,
  now = () => new Date()
}) {
  async function exportWorkspace() {
    return {
      schemaVersion,
      exportedAt: now().toISOString(),
      workspace: await workspaceStore.getWorkspace()
    };
  }

  return {
    async health() {
      try {
        await workspaceStore.getWorkspace();
        return { status: 'ok', storage: 'ready' };
      } catch {
        return { status: 'degraded', storage: 'unavailable' };
      }
    },
    async metrics() {
      return metricsFrom(await workspaceStore.getWorkspace());
    },
    exportWorkspace,
    async verifyCurrent() {
      return verifyWorkspaceExport(await exportWorkspace());
    },
    async prune() {
      return workspaceStore.prune({
        retentionDays,
        eventLimit,
        auditLimit,
        now: now()
      });
    },
    async backup() {
      if (!backupDirectory) throw new Error('Workspace backup directory is not configured.');
      const payload = await exportWorkspace();
      const verification = verifyWorkspaceExport(payload);
      if (!verification.valid) {
        throw new Error(`Workspace export failed verification: ${verification.errors.join(' ')}`);
      }
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const stamp = payload.exportedAt.replaceAll(':', '-').replaceAll('.', '-');
      const filePath = join(backupDirectory, `workspace-${stamp}.json`);
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(payload, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, filePath);
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      const savedVerification = verifyWorkspaceExport(saved);
      if (!savedVerification.valid) throw new Error('Saved workspace backup failed verification.');
      return { filePath, exportedAt: payload.exportedAt, metrics: metricsFrom(payload.workspace) };
    }
  };
}
