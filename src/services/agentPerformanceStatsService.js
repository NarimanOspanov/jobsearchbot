import { Sequelize } from 'sequelize';
import { models, sequelize } from '../db.js';
import { buildAdminUserContactProjection } from './userService.js';

function buildUserLabel(user) {
  if (!user) return '—';
  const projection = buildAdminUserContactProjection(user);
  const firstName = String(projection.displayFirstName || user.FirstName || '').trim();
  const lastName = String(projection.displayLastName || user.LastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const username = String(user.TelegramUserName || '').trim();
  if (fullName && username) return `${fullName} (@${username})`;
  if (fullName) return fullName;
  if (username) return `@${username}`;
  return `User #${user.Id ?? '-'}`;
}

export async function buildAgentPerformanceStats({ since } = {}) {
  const sinceDate = since instanceof Date ? since : new Date(since);
  const empty = {
    totals: {
      agents: 0,
      assignedClients: 0,
      activityCount: 0,
      appliedCount: 0,
    },
    byAgent: [],
    byAgentClient: [],
    byStatus: [],
    bySource: [],
    byApplyType: [],
    dailyApplied: [],
    recent: [],
  };

  if (!models.AgentClients || !models.Applications) {
    return empty;
  }

  const [assignmentRows, byAgentActivityRows, byAgentClientRows, statusRows, sourceRows, applyTypeRows, dailyRows, recentRows] =
    await Promise.all([
      sequelize.query(
        `SELECT ac.AgentUserId AS agentUserId, COUNT(*) AS assignedClients
         FROM dbo.AgentClients AS ac
         GROUP BY ac.AgentUserId`,
        { type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           ac.AgentUserId AS agentUserId,
           COUNT(a.Id) AS activityCount,
           SUM(CASE WHEN LOWER(LTRIM(RTRIM(a.Status))) = 'applied' THEN 1 ELSE 0 END) AS appliedCount
         FROM dbo.AgentClients AS ac
         LEFT JOIN dbo.Applications AS a ON a.UserId = ac.ClientUserId AND a.AppliedAt >= :since
         GROUP BY ac.AgentUserId`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           ac.AgentUserId AS agentUserId,
           ac.ClientUserId AS clientUserId,
           COUNT(a.Id) AS activityCount,
           SUM(CASE WHEN LOWER(LTRIM(RTRIM(a.Status))) = 'applied' THEN 1 ELSE 0 END) AS appliedCount
         FROM dbo.AgentClients AS ac
         LEFT JOIN dbo.Applications AS a ON a.UserId = ac.ClientUserId AND a.AppliedAt >= :since
         GROUP BY ac.AgentUserId, ac.ClientUserId
         HAVING COUNT(a.Id) > 0`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           ac.AgentUserId AS agentUserId,
           LOWER(LTRIM(RTRIM(a.Status))) AS status,
           COUNT(*) AS cnt
         FROM dbo.Applications AS a
         INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
         WHERE a.AppliedAt >= :since
         GROUP BY ac.AgentUserId, LOWER(LTRIM(RTRIM(a.Status)))`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           ac.AgentUserId AS agentUserId,
           COALESCE(NULLIF(LTRIM(RTRIM(a.Source)), ''), '—') AS source,
           COUNT(*) AS cnt
         FROM dbo.Applications AS a
         INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
         WHERE a.AppliedAt >= :since AND LOWER(LTRIM(RTRIM(a.Status))) = 'applied'
         GROUP BY ac.AgentUserId, COALESCE(NULLIF(LTRIM(RTRIM(a.Source)), ''), '—')`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           ac.AgentUserId AS agentUserId,
           COALESCE(NULLIF(LTRIM(RTRIM(a.ApplyType)), ''), '—') AS applyType,
           COUNT(*) AS cnt
         FROM dbo.Applications AS a
         INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
         WHERE a.AppliedAt >= :since AND LOWER(LTRIM(RTRIM(a.Status))) = 'applied'
         GROUP BY ac.AgentUserId, COALESCE(NULLIF(LTRIM(RTRIM(a.ApplyType)), ''), '—')`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT
           CAST(a.AppliedAt AS DATE) AS day,
           COUNT(*) AS appliedCount
         FROM dbo.Applications AS a
         INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
         WHERE a.AppliedAt >= :since AND LOWER(LTRIM(RTRIM(a.Status))) = 'applied'
         GROUP BY CAST(a.AppliedAt AS DATE)
         ORDER BY CAST(a.AppliedAt AS DATE) ASC`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT TOP 100
           a.Id AS applicationId,
           a.AppliedAt AS appliedAt,
           a.VacancyTitle AS vacancyTitle,
           a.CompanyName AS companyName,
           a.Source AS source,
           a.ApplyType AS applyType,
           a.Status AS status,
           ac.AgentUserId AS agentUserId,
           a.UserId AS clientUserId
         FROM dbo.Applications AS a
         INNER JOIN dbo.AgentClients AS ac ON ac.ClientUserId = a.UserId
         WHERE a.AppliedAt >= :since AND LOWER(LTRIM(RTRIM(a.Status))) = 'applied'
         ORDER BY a.AppliedAt DESC`,
        { replacements: { since: sinceDate }, type: Sequelize.QueryTypes.SELECT }
      ),
    ]);

  const userIds = new Set();
  for (const row of assignmentRows || []) userIds.add(Number(row.agentUserId));
  for (const row of byAgentClientRows || []) {
    userIds.add(Number(row.agentUserId));
    userIds.add(Number(row.clientUserId));
  }
  for (const row of recentRows || []) {
    userIds.add(Number(row.agentUserId));
    userIds.add(Number(row.clientUserId));
  }

  const users = userIds.size
    ? await models.Users.findAll({
        where: { Id: { [Sequelize.Op.in]: [...userIds] } },
      })
    : [];
  const userById = new Map(users.map((u) => [Number(u.Id), u]));

  const assignedByAgent = new Map(
    (assignmentRows || []).map((row) => [Number(row.agentUserId), Number(row.assignedClients || 0)])
  );
  const activityByAgent = new Map(
    (byAgentActivityRows || []).map((row) => [
      Number(row.agentUserId),
      {
        activityCount: Number(row.activityCount || 0),
        appliedCount: Number(row.appliedCount || 0),
      },
    ])
  );

  const statusByAgent = new Map();
  for (const row of statusRows || []) {
    const agentUserId = Number(row.agentUserId);
    const bucket = statusByAgent.get(agentUserId) || [];
    bucket.push({ status: String(row.status || '—'), count: Number(row.cnt || 0) });
    statusByAgent.set(agentUserId, bucket);
  }

  const agentIds = [...new Set([...assignedByAgent.keys(), ...activityByAgent.keys()])];
  const byAgent = agentIds
    .map((agentUserId) => {
      const activity = activityByAgent.get(agentUserId) || { activityCount: 0, appliedCount: 0 };
      const agent = userById.get(agentUserId);
      const statuses = (statusByAgent.get(agentUserId) || []).sort((a, b) => b.count - a.count);
      return {
        agentUserId,
        agentName: buildUserLabel(agent),
        assignedClients: assignedByAgent.get(agentUserId) || 0,
        activityCount: activity.activityCount,
        appliedCount: activity.appliedCount,
        statuses,
      };
    })
    .sort((a, b) => b.appliedCount - a.appliedCount || b.activityCount - a.activityCount);

  const byAgentClient = (byAgentClientRows || [])
    .map((row) => {
      const agentUserId = Number(row.agentUserId);
      const clientUserId = Number(row.clientUserId);
      return {
        agentUserId,
        agentName: buildUserLabel(userById.get(agentUserId)),
        clientUserId,
        clientName: buildUserLabel(userById.get(clientUserId)),
        activityCount: Number(row.activityCount || 0),
        appliedCount: Number(row.appliedCount || 0),
      };
    })
    .sort((a, b) => b.appliedCount - a.appliedCount || b.activityCount - a.activityCount);

  const byStatusMap = new Map();
  for (const row of statusRows || []) {
    const status = String(row.status || '—');
    byStatusMap.set(status, (byStatusMap.get(status) || 0) + Number(row.cnt || 0));
  }
  const byStatus = [...byStatusMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const bySource = (sourceRows || [])
    .map((row) => ({
      agentUserId: Number(row.agentUserId),
      agentName: buildUserLabel(userById.get(Number(row.agentUserId))),
      source: String(row.source || '—'),
      count: Number(row.cnt || 0),
    }))
    .sort((a, b) => b.count - a.count);

  const byApplyType = (applyTypeRows || [])
    .map((row) => ({
      agentUserId: Number(row.agentUserId),
      agentName: buildUserLabel(userById.get(Number(row.agentUserId))),
      applyType: String(row.applyType || '—'),
      count: Number(row.cnt || 0),
    }))
    .sort((a, b) => b.count - a.count);

  const dailyApplied = (dailyRows || []).map((row) => ({
    date: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day || '').slice(0, 10),
    appliedCount: Number(row.appliedCount || 0),
  }));

  const recent = (recentRows || []).map((row) => {
    const agentUserId = Number(row.agentUserId);
    const clientUserId = Number(row.clientUserId);
    return {
      applicationId: Number(row.applicationId),
      appliedAt: row.appliedAt || null,
      vacancyTitle: row.vacancyTitle || null,
      companyName: row.companyName || null,
      source: row.source || null,
      applyType: row.applyType || null,
      status: row.status || null,
      agentUserId,
      agentName: buildUserLabel(userById.get(agentUserId)),
      clientUserId,
      clientName: buildUserLabel(userById.get(clientUserId)),
    };
  });

  const totals = {
    agents: byAgent.length,
    assignedClients: [...assignedByAgent.values()].reduce((sum, n) => sum + n, 0),
    activityCount: byAgent.reduce((sum, row) => sum + row.activityCount, 0),
    appliedCount: byAgent.reduce((sum, row) => sum + row.appliedCount, 0),
  };

  return {
    totals,
    byAgent,
    byAgentClient,
    byStatus,
    bySource,
    byApplyType,
    dailyApplied,
    recent,
  };
}
