import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth } from '../../middleware/auth.js';
import { models } from '../../db.js';
import { adminNotificationRunControl, runtimeBot } from '../../bot/state.js';

function normalizeNotificationText(value) {
  const raw = value == null ? '' : String(value);
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized.slice(0, 4000);
}

function toChatId(value) {
  const s = String(value ?? '').trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(n) || n === 0) return null;
  return n;
}

function serializeAdminNotificationRun(row) {
  if (!row) return null;
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  return {
    id: String(plain.Id || ''),
    initiatorChatId: String(plain.InitiatorChatId || ''),
    text: String(plain.Text || ''),
    total: Number(plain.Total || 0),
    processed: Number(plain.Processed || 0),
    sent: Number(plain.Sent || 0),
    failed: Number(plain.Failed || 0),
    status: String(plain.Status || ''),
    stopRequestedAt: plain.StopRequestedAt || null,
    startedAt: plain.StartedAt || null,
    stoppedAt: plain.StoppedAt || null,
    finishedAt: plain.FinishedAt || null,
    createdAt: plain.CreatedAt || null,
    updatedAt: plain.UpdatedAt || null,
  };
}

function serializeAdminNotification(row) {
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  const receiverType = String(plain.ReceiverType || '');
  return {
    id: String(plain.Id || ''),
    runId: plain.RunId ? String(plain.RunId) : null,
    initiatorChatId: String(plain.InitiatorChatId || ''),
    text: String(plain.Text || ''),
    receiverType,
    receiverChatId: plain.ReceiverChatId == null ? null : String(plain.ReceiverChatId),
    receiverLabel:
      receiverType === 'all'
        ? plain.ReceiverChatId == null
          ? 'All users'
          : `All users (${String(plain.ReceiverChatId)})`
        : plain.ReceiverChatId == null
          ? 'Unknown'
          : String(plain.ReceiverChatId),
    status: String(plain.Status || ''),
    error: plain.Error || null,
    sentAt: plain.SentAt || null,
    createdAt: plain.CreatedAt || null,
    updatedAt: plain.UpdatedAt || null,
  };
}

async function findCurrentAdminNotificationRun() {
  if (!models.AdminNotificationRuns) return null;
  return models.AdminNotificationRuns.findOne({
    where: { Status: { [Sequelize.Op.in]: ['running', 'stopping'] } },
    order: [['StartedAt', 'DESC'], ['CreatedAt', 'DESC']],
  });
}

async function processAdminNotificationRun(runId) {
  if (!models.AdminNotificationRuns || !models.AdminNotifications || !runtimeBot.telegram) return;
  try {
    let run = await models.AdminNotificationRuns.findByPk(runId);
    if (!run) return;
    const queuedRows = await models.AdminNotifications.findAll({
      where: { RunId: runId, Status: 'queued' },
      order: [['CreatedAt', 'ASC']],
    });
    for (const row of queuedRows) {
      if (adminNotificationRunControl.stopRequestedRunIds.has(runId)) break;
      const receiverChatId = toChatId(row.ReceiverChatId);
      if (!receiverChatId) {
        await row.update({ Status: 'failed', Error: 'Invalid receiver chat id', UpdatedAt: new Date() });
        run = await run.reload();
        await run.update({ Processed: Number(run.Processed || 0) + 1, Failed: Number(run.Failed || 0) + 1, UpdatedAt: new Date() });
        continue;
      }
      await row.update({ Status: 'sending', UpdatedAt: new Date() });
      let isSent = false;
      let errorText = null;
      try {
        await runtimeBot.telegram.sendMessage(receiverChatId, String(row.Text || ''));
        isSent = true;
      } catch (err) {
        errorText = String(err?.response?.description || err?.message || err || 'Failed to send').slice(0, 500);
      }
      const now = new Date();
      await row.update({ Status: isSent ? 'sent' : 'failed', Error: isSent ? null : errorText, SentAt: isSent ? now : null, UpdatedAt: now });
      run = await run.reload();
      await run.update({
        Processed: Number(run.Processed || 0) + 1,
        Sent: Number(run.Sent || 0) + (isSent ? 1 : 0),
        Failed: Number(run.Failed || 0) + (isSent ? 0 : 1),
        UpdatedAt: now,
      });
    }

    run = await run.reload();
    const stopRequested = adminNotificationRunControl.stopRequestedRunIds.has(runId);
    if (stopRequested) {
      await models.AdminNotifications.update(
        { Status: 'stopped', UpdatedAt: new Date() },
        { where: { RunId: runId, Status: 'queued' } }
      );
      const stoppedCount = await models.AdminNotifications.count({ where: { RunId: runId, Status: 'stopped' } });
      await run.update({
        Processed: Number(run.Total || 0),
        Failed: Number(run.Failed || 0) + Math.max(0, stoppedCount),
        Status: 'stopped',
        StoppedAt: new Date(),
        FinishedAt: new Date(),
        UpdatedAt: new Date(),
      });
    } else {
      await run.update({ Status: 'completed', FinishedAt: new Date(), UpdatedAt: new Date() });
    }
  } catch (err) {
    console.error('processAdminNotificationRun error:', err);
    if (models.AdminNotificationRuns) {
      try {
        await models.AdminNotificationRuns.update(
          { Status: 'failed', FinishedAt: new Date(), UpdatedAt: new Date() },
          { where: { Id: runId } }
        );
      } catch {
        // no-op
      }
    }
  } finally {
    adminNotificationRunControl.stopRequestedRunIds.delete(runId);
    if (adminNotificationRunControl.activeRunId === runId) {
      adminNotificationRunControl.activeRunId = null;
    }
  }
}

export function createNotificationsRouter() {
  const router = Router();

  router.post('/api/app/admin/notifications/send', adminMiniAppAuth, async (req, res) => {
    try {
      if (!models.AdminNotifications || !models.AdminNotificationRuns) {
        return res.status(503).json({ error: 'Admin notifications are unavailable' });
      }
      const mode = String(req.body.mode || '').trim().toLowerCase();
      const text = normalizeNotificationText(req.body.text);
      const initiatorChatId = Number(req.miniAppUser?.id || 0);
      if (!text) return res.status(400).json({ error: 'Text is required' });
      if (!runtimeBot.telegram) return res.status(503).json({ error: 'Telegram bot is unavailable' });

      if (mode === 'single') {
        const receiverChatId = toChatId(req.body.receiverChatId);
        if (!receiverChatId) return res.status(400).json({ error: 'receiverChatId is required for single mode' });
        const id = randomUUID();
        const row = await models.AdminNotifications.create({
          Id: id,
          RunId: null,
          InitiatorChatId: initiatorChatId,
          Text: text,
          ReceiverType: 'single',
          ReceiverChatId: receiverChatId,
          Status: 'sending',
          CreatedAt: new Date(),
          UpdatedAt: new Date(),
        });
        try {
          await runtimeBot.telegram.sendMessage(receiverChatId, text);
          await row.update({ Status: 'sent', SentAt: new Date(), UpdatedAt: new Date(), Error: null });
        } catch (err) {
          await row.update({
            Status: 'failed',
            Error: String(err?.response?.description || err?.message || err || 'Failed to send').slice(0, 500),
            UpdatedAt: new Date(),
          });
        }
        const reloaded = await models.AdminNotifications.findByPk(id);
        return res.json({ ok: true, notification: serializeAdminNotification(reloaded) });
      }

      if (mode !== 'all') {
        return res.status(400).json({ error: 'mode must be "single" or "all"' });
      }

      const currentRun = await findCurrentAdminNotificationRun();
      if (currentRun) {
        return res.status(409).json({ error: 'Another bulk send is in progress', run: serializeAdminNotificationRun(currentRun) });
      }

      const users = await models.Users.findAll({
        where: { TelegramChatId: { [Sequelize.Op.ne]: null } },
        attributes: ['TelegramChatId'],
        order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
      });
      const seen = new Set();
      const recipients = [];
      for (const user of users) {
        const chatId = toChatId(user.TelegramChatId);
        if (!chatId) continue;
        if (chatId < 0) continue;
        if (seen.has(chatId)) continue;
        seen.add(chatId);
        recipients.push(chatId);
      }
      if (recipients.length === 0) {
        return res.status(400).json({ error: 'No eligible recipients found' });
      }

      const runId = randomUUID();
      const now = new Date();
      const run = await models.AdminNotificationRuns.create({
        Id: runId,
        InitiatorChatId: initiatorChatId,
        Text: text,
        Total: recipients.length,
        Processed: 0,
        Sent: 0,
        Failed: 0,
        Status: 'running',
        StartedAt: now,
        CreatedAt: now,
        UpdatedAt: now,
      });
      await models.AdminNotifications.bulkCreate(
        recipients.map((chatId) => ({
          Id: randomUUID(),
          RunId: runId,
          InitiatorChatId: initiatorChatId,
          Text: text,
          ReceiverType: 'all',
          ReceiverChatId: chatId,
          Status: 'queued',
          CreatedAt: now,
          UpdatedAt: now,
        }))
      );
      adminNotificationRunControl.activeRunId = runId;
      processAdminNotificationRun(runId).catch((err) => {
        console.error('processAdminNotificationRun launch error:', err);
      });
      return res.status(202).json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('POST /api/app/admin/notifications/send:', err);
      return res.status(500).json({ error: 'Failed to send notifications' });
    }
  });

  router.post('/api/app/admin/notifications/:runId/stop', adminMiniAppAuth, async (req, res) => {
    try {
      const runId = String(req.params.runId || '').trim();
      if (!runId) return res.status(400).json({ error: 'Invalid runId' });
      const run = await models.AdminNotificationRuns?.findByPk(runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      if (!['running', 'stopping'].includes(String(run.Status || ''))) {
        return res.status(400).json({ error: 'Run is not active' });
      }
      adminNotificationRunControl.stopRequestedRunIds.add(runId);
      await run.update({ Status: 'stopping', StopRequestedAt: run.StopRequestedAt || new Date(), UpdatedAt: new Date() });
      return res.json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('POST /api/app/admin/notifications/:runId/stop:', err);
      return res.status(500).json({ error: 'Failed to stop run' });
    }
  });

  router.get('/api/app/admin/notifications/runs/current', adminMiniAppAuth, async (_req, res) => {
    try {
      const run = await findCurrentAdminNotificationRun();
      return res.json({ ok: true, run: serializeAdminNotificationRun(run) });
    } catch (err) {
      console.error('GET /api/app/admin/notifications/runs/current:', err);
      return res.status(500).json({ error: 'Failed to load current run' });
    }
  });

  router.get('/api/app/admin/notifications/history', adminMiniAppAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.AdminNotifications.findAll({
        order: [['CreatedAt', 'DESC'], ['Id', 'DESC']],
        limit,
        offset,
      });
      const total = await models.AdminNotifications.count();
      return res.json({ ok: true, total, rows: rows.map(serializeAdminNotification) });
    } catch (err) {
      console.error('GET /api/app/admin/notifications/history:', err);
      return res.status(500).json({ error: 'Failed to load notification history' });
    }
  });

  return router;
}
