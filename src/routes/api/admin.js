import { Router } from 'express';
import { Sequelize } from 'sequelize';
import { adminMiniAppAuth } from '../../middleware/auth.js';
import { models, sequelize } from '../../db.js';
import { buildAdminUserContactProjection } from '../../services/userService.js';
import { extractResumeTextFromUrl } from '../../services/resumeService.js';

export function createAdminRouter() {
  const router = Router();

  router.get('/api/app/admin/stat2', adminMiniAppAuth, async (req, res) => {
    try {
      const periodRaw = String(req.query.period || '7').trim();
      const period = /^\d+$/.test(periodRaw)
        ? Math.min(365, Math.max(1, Number.parseInt(periodRaw, 10)))
        : 7;
      const now = Date.now();
      const since = new Date(now - period * 24 * 60 * 60 * 1000);
      const toUtcDateKey = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().slice(0, 10);
      };
      const byDay = new Map();
      for (let i = period - 1; i >= 0; i -= 1) {
        const day = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        byDay.set(day, { date: day, usersJoined: 0, usersJoinedByInvite: 0, payments: 0, requiredChannelUsers: 0, jobDetailsOpens: 0 });
      }
      const usersJoinedRowsPromise = models.Users
        ? models.Users.findAll({ attributes: ['DateJoined'], where: { DateJoined: { [Sequelize.Op.gte]: since } }, raw: true })
        : Promise.resolve([]);
      const invitedRowsPromise = models.Referrals
        ? models.Referrals.findAll({ attributes: ['ReferredAt', 'ReferredUserId'], where: { ReferredAt: { [Sequelize.Op.gte]: since } }, raw: true })
        : Promise.resolve([]);
      const paymentsRowsPromise = models.TelegramPayments
        ? models.TelegramPayments.findAll({ attributes: ['PaidAt'], where: { PaidAt: { [Sequelize.Op.gte]: since } }, raw: true })
        : Promise.resolve([]);
      const requiredRowsPromise = models.RequiredChannelUsers
        ? models.RequiredChannelUsers.findAll({ attributes: ['DateTime', 'UserId'], where: { DateTime: { [Sequelize.Op.gte]: since } }, raw: true })
        : Promise.resolve([]);
      const jobDetailsOpensRowsPromise = models.JobDetailsOpens
        ? models.JobDetailsOpens.findAll({ attributes: ['CreatedAt'], where: { CreatedAt: { [Sequelize.Op.gte]: since } }, raw: true })
        : Promise.resolve([]);
      const [usersJoinedRows, invitedRows, paymentsRows, requiredRows, jobDetailsOpensRows] = await Promise.all([
        usersJoinedRowsPromise, invitedRowsPromise, paymentsRowsPromise, requiredRowsPromise, jobDetailsOpensRowsPromise,
      ]);
      for (const row of usersJoinedRows) {
        const key = toUtcDateKey(row?.DateJoined);
        if (key && byDay.has(key)) byDay.get(key).usersJoined += 1;
      }
      for (const row of invitedRows) {
        const key = toUtcDateKey(row?.ReferredAt);
        if (key && byDay.has(key)) byDay.get(key).usersJoinedByInvite += 1;
      }
      for (const row of paymentsRows) {
        const key = toUtcDateKey(row?.PaidAt);
        if (key && byDay.has(key)) byDay.get(key).payments += 1;
      }
      const requiredUserPerDaySet = new Set();
      for (const row of requiredRows) {
        const key = toUtcDateKey(row?.DateTime);
        const userId = Number.parseInt(String(row?.UserId || ''), 10);
        if (!key || !byDay.has(key) || !Number.isSafeInteger(userId)) continue;
        const dedupeKey = `${key}:${userId}`;
        if (requiredUserPerDaySet.has(dedupeKey)) continue;
        requiredUserPerDaySet.add(dedupeKey);
        byDay.get(key).requiredChannelUsers += 1;
      }
      for (const row of jobDetailsOpensRows) {
        const key = toUtcDateKey(row?.CreatedAt);
        if (key && byDay.has(key)) byDay.get(key).jobDetailsOpens += 1;
      }
      const series = Array.from(byDay.values());
      const totals = series.reduce((acc, row) => {
        acc.usersJoined += row.usersJoined;
        acc.usersJoinedByInvite += row.usersJoinedByInvite;
        acc.payments += row.payments;
        acc.requiredChannelUsers += row.requiredChannelUsers;
        acc.jobDetailsOpens += row.jobDetailsOpens;
        return acc;
      }, { usersJoined: 0, usersJoinedByInvite: 0, payments: 0, requiredChannelUsers: 0, jobDetailsOpens: 0 });
      return res.json({ success: true, period, since: since.toISOString(), totals, series });
    } catch (err) {
      console.error('GET /api/app/admin/stat2:', err);
      return res.status(500).json({ error: 'Failed to load stat2 data' });
    }
  });

  router.get('/api/app/admin/stat2/details', adminMiniAppAuth, async (req, res) => {
    try {
      const metric = String(req.query.metric || '').trim();
      const limitRaw = Number.parseInt(String(req.query.limit || '100'), 10);
      const limit = Number.isSafeInteger(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 100;

      const buildUserLabel = (user) => {
        const firstName = String(user?.FirstName || '').trim();
        const lastName = String(user?.LastName || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
        const username = String(user?.TelegramUserName || '').trim();
        if (fullName && username) return `${fullName} (@${username})`;
        if (fullName) return fullName;
        if (username) return `@${username}`;
        return `User ${user?.Id ?? '-'}`;
      };

      if (metric === 'usersJoined') {
        const rows = models.Users
          ? await models.Users.findAll({ attributes: ['Id', 'FirstName', 'LastName', 'TelegramUserName', 'DateJoined'], order: [['DateJoined', 'DESC'], ['Id', 'DESC']], limit, raw: true })
          : [];
        return res.json({ success: true, metric, items: rows.map((row) => ({ user: buildUserLabel(row), datetime: row?.DateJoined || null })) });
      }

      if (metric === 'usersJoinedByInvite') {
        const rows = models.Referrals
          ? await models.Referrals.findAll({ attributes: ['ReferrerUserId', 'ReferredUserId', 'ReferredAt'], order: [['ReferredAt', 'DESC']], limit, raw: true })
          : [];
        const userIds = Array.from(new Set(rows.flatMap((row) => [Number(row?.ReferrerUserId), Number(row?.ReferredUserId)]).filter((id) => Number.isSafeInteger(id) && id > 0)));
        const users = userIds.length > 0 && models.Users
          ? await models.Users.findAll({ attributes: ['Id', 'FirstName', 'LastName', 'TelegramUserName'], where: { Id: { [Sequelize.Op.in]: userIds } }, raw: true })
          : [];
        const userById = new Map(users.map((user) => [Number(user.Id), user]));
        const items = rows.map((row) => {
          const referred = userById.get(Number(row?.ReferredUserId));
          const referrer = userById.get(Number(row?.ReferrerUserId));
          return {
            user: referred ? buildUserLabel(referred) : `User ${row?.ReferredUserId ?? '-'}`,
            datetime: row?.ReferredAt || null,
            invitedBy: referrer ? buildUserLabel(referrer) : `User ${row?.ReferrerUserId ?? '-'}`,
          };
        });
        return res.json({ success: true, metric, items });
      }

      if (metric === 'payments') {
        const rows = models.TelegramPayments
          ? await models.TelegramPayments.findAll({ attributes: ['UserId', 'PaidAt'], order: [['PaidAt', 'DESC'], ['Id', 'DESC']], limit, raw: true })
          : [];
        const userIds = Array.from(new Set(rows.map((row) => Number(row?.UserId)).filter((id) => Number.isSafeInteger(id) && id > 0)));
        const users = userIds.length > 0 && models.Users
          ? await models.Users.findAll({ attributes: ['Id', 'FirstName', 'LastName', 'TelegramUserName'], where: { Id: { [Sequelize.Op.in]: userIds } }, raw: true })
          : [];
        const userById = new Map(users.map((user) => [Number(user.Id), user]));
        const items = rows.map((row) => {
          const user = userById.get(Number(row?.UserId));
          return { user: user ? buildUserLabel(user) : `User ${row?.UserId ?? '-'}`, datetime: row?.PaidAt || null };
        });
        return res.json({ success: true, metric, items });
      }

      if (metric === 'requiredChannelUsers') {
        const rows = models.RequiredChannelUsers
          ? await models.RequiredChannelUsers.findAll({ attributes: ['UserId', 'DateTime'], order: [['DateTime', 'DESC'], ['Id', 'DESC']], limit, raw: true })
          : [];
        const telegramIds = Array.from(new Set(rows.map((row) => Number.parseInt(String(row?.UserId || ''), 10)).filter((id) => Number.isSafeInteger(id) && id > 0)));
        const users = telegramIds.length > 0 && models.Users
          ? await models.Users.findAll({ attributes: ['TelegramChatId', 'FirstName', 'LastName', 'TelegramUserName'], where: { TelegramChatId: { [Sequelize.Op.in]: telegramIds } }, raw: true })
          : [];
        const userByTelegramId = new Map(users.map((user) => [Number(user.TelegramChatId), user]));
        const items = rows.map((row) => {
          const telegramId = Number.parseInt(String(row?.UserId || ''), 10);
          const user = userByTelegramId.get(telegramId);
          return { user: user ? buildUserLabel(user) : `Telegram ${row?.UserId ?? '-'}`, datetime: row?.DateTime || null };
        });
        return res.json({ success: true, metric, items });
      }

      if (metric === 'jobDetailsOpens') {
        const periodRaw = String(req.query.period || '7').trim();
        const period = /^\d+$/.test(periodRaw) ? Math.min(365, Math.max(1, Number.parseInt(periodRaw, 10))) : 7;
        const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
        if (!models.JobDetailsOpens || !models.Users) {
          return res.json({ success: true, metric, period, since: since.toISOString(), items: [] });
        }
        const rows = await sequelize.query(
          `SELECT u.Id AS userId, u.TelegramUserName AS telegramUserName, u.TelegramChatId AS telegramChatId, COUNT(*) AS numberOfJobDetailsOpens
           FROM dbo.JobDetailsOpens AS jdo
           INNER JOIN dbo.Users AS u ON u.Id = jdo.UserId
           WHERE jdo.CreatedAt >= :since
           GROUP BY u.Id, u.TelegramUserName, u.TelegramChatId
           ORDER BY numberOfJobDetailsOpens DESC
           OFFSET 0 ROWS FETCH NEXT :limit ROWS ONLY`,
          { replacements: { since, limit }, type: Sequelize.QueryTypes.SELECT }
        );
        const items = (Array.isArray(rows) ? rows : []).map((row) => ({
          userId: row?.userId ?? null,
          telegramUserName: row?.telegramUserName ?? null,
          telegramChatId: row?.telegramChatId ?? null,
          numberOfJobDetailsOpens: Number(row?.numberOfJobDetailsOpens || 0),
        }));
        return res.json({ success: true, metric, period, since: since.toISOString(), items });
      }

      return res.status(400).json({ error: 'Unknown metric' });
    } catch (err) {
      console.error('GET /api/app/admin/stat2/details:', err);
      return res.status(500).json({ error: 'Failed to load stat2 details' });
    }
  });

  router.get('/api/app/admin/users/search', adminMiniAppAuth, async (req, res) => {
    try {
      const query = String(req.query.q || '').trim();
      if (!query) return res.json([]);
      const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
      const isDigits = /^\d+$/.test(query);
      const rows = await models.Users.findAll({
        where: {
          [Sequelize.Op.or]: [
            { TelegramUserName: { [Sequelize.Op.like]: `%${query}%` } },
            { FirstName: { [Sequelize.Op.like]: `%${query}%` } },
            { LastName: { [Sequelize.Op.like]: `%${query}%` } },
            ...(isDigits ? [{ TelegramChatId: Number.parseInt(query, 10) }] : []),
          ],
        },
        order: [['DateJoined', 'DESC'], ['Id', 'DESC']],
        limit,
      });
      return res.json(rows.map((u) => ({
        id: u.Id,
        telegramChatId: String(u.TelegramChatId || ''),
        telegramUserName: u.TelegramUserName || null,
        firstName: u.FirstName || null,
        lastName: u.LastName || null,
      })));
    } catch (err) {
      console.error('GET /api/app/admin/users/search:', err);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  });

  router.get('/api/app/admin/users', adminMiniAppAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rows = await models.Users.findAll({ order: [['DateJoined', 'DESC'], ['Id', 'DESC']], limit, offset });
      res.json(rows.map((u) => {
        const projection = buildAdminUserContactProjection(u);
        return {
          id: u.Id,
          telegramChatId: String(u.TelegramChatId),
          telegramUserName: u.TelegramUserName,
          firstName: u.FirstName || null,
          lastName: u.LastName || null,
          dateJoined: u.DateJoined,
          isBlocked: !!u.IsBlocked,
          resumeUrl: u.ResumeURL || null,
          ...projection,
        };
      }));
    } catch (err) {
      console.error('GET /api/app/admin/users:', err);
      res.status(500).json({ error: 'Failed to load users' });
    }
  });

  router.get('/api/app/admin/users/:id', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const u = await models.Users.findByPk(id);
      if (!u) return res.status(404).json({ error: 'User not found' });
      res.json({
        id: u.Id,
        telegramChatId: String(u.TelegramChatId),
        telegramUserName: u.TelegramUserName,
        firstName: u.FirstName || null,
        lastName: u.LastName || null,
        dateJoined: u.DateJoined,
        isBlocked: !!u.IsBlocked,
        muteBotUntil: u.MuteBotUntil,
        timezone: u.Timezone,
        promocode: u.Promocode,
        resumeUrl: u.ResumeURL || null,
        settings: {
          hhEnabled: !!u.HhEnabled,
          linkedInEnabled: !!u.LinkedInEnabled,
          indeedEnabled: !!u.IndeedEnabled,
          telegramEnabled: !!u.TelegramEnabled,
          companySitesEnabled: !!u.CompanySitesEnabled,
          emailFoundersEnabled: !!u.EmailFoundersEnabled,
          emailRecruitersEnabled: !!u.EmailRecruitersEnabled,
          searchMode: u.SearchMode || 'not_urgent',
          minimumSalary: u.MinimumSalary,
          remoteOnly: !!u.RemoteOnly,
        },
        ...buildAdminUserContactProjection(u),
      });
    } catch (err) {
      console.error('GET /api/app/admin/users/:id:', err);
      res.status(500).json({ error: 'Failed to load user' });
    }
  });

  router.get('/api/app/admin/users/:id/resume-text', adminMiniAppAuth, async (req, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
      const user = await models.Users.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.ResumeURL) return res.status(404).json({ error: 'Resume URL is not set for this user' });
      const resumeText = await extractResumeTextFromUrl(user.ResumeURL);
      if (!resumeText) return res.status(422).json({ error: 'Could not extract resume text' });
      return res.json({ userId: id, resumeUrl: user.ResumeURL, resumeText });
    } catch (err) {
      console.error('GET /api/app/admin/users/:id/resume-text:', err);
      return res.status(500).json({ error: 'Failed to extract resume text' });
    }
  });

  return router;
}
