import { Sequelize } from 'sequelize';
import { models } from '../db.js';

function buildApplyPriorityContextKey(client, jobs) {
  const searchMode = String(client?.SearchMode || 'not_urgent').trim();
  const comment = String(client?.Comment || '').trim();
  const resumeUrl = String(client?.ResumeURL || '').trim();
  const jobIds = (Array.isArray(jobs) ? jobs : [])
    .map((job) => Number.parseInt(String(job?.id ?? ''), 10))
    .filter((id) => Number.isSafeInteger(id))
    .sort((a, b) => a - b)
    .join(',');
  return `${searchMode}|${comment}|${resumeUrl}|${jobIds}`;
}

export async function persistApplyPriorityForPageJobs({ clientUserId, client, jobs, rankings, context }) {
  const normalizedJobs = (Array.isArray(jobs) ? jobs : [])
    .map((job) => ({
      id: Number.parseInt(String(job?.id ?? ''), 10),
      title: String(job?.title || '').trim(),
      company: String(job?.company || '').trim(),
      source: String(job?.source || '').trim() || null,
      applyType: String(job?.applyType || '').trim() || null,
      applyUrl: String(job?.applyUrl || '').trim() || null,
      location: String(job?.location || '').trim() || null,
      shortSummary: String(job?.shortSummary || '').trim() || null,
    }))
    .filter((job) => Number.isSafeInteger(job.id));
  if (!normalizedJobs.length) return { createdCount: 0, updatedCount: 0, total: 0 };

  const rankingByJobId = new Map(
    (Array.isArray(rankings) ? rankings : []).map((row) => [Number.parseInt(String(row?.jobId ?? ''), 10), row])
  );
  const jobIds = normalizedJobs.map((job) => job.id);
  const existingRows = await models.Applications.findAll({
    where: {
      UserId: clientUserId,
      ScreenlyJobId: { [Sequelize.Op.in]: jobIds },
    },
  });
  const existingByJobId = new Map(existingRows.map((row) => [Number(row.ScreenlyJobId), row]));
  const contextKey = buildApplyPriorityContextKey(client, normalizedJobs);
  const analyzedAt = new Date().toISOString();

  let createdCount = 0;
  let updatedCount = 0;
  for (const job of normalizedJobs) {
    const ranking = rankingByJobId.get(job.id);
    if (!ranking) continue;
    const applyPriorityJson = JSON.stringify({
      score: Number(ranking.score) || 0,
      applyRank: Number(ranking.applyRank) || 0,
      priority: String(ranking.priority || 'good'),
      justification: String(ranking.justification || ''),
      skipReason: ranking.skipReason ? String(ranking.skipReason) : null,
      analyzedAt,
      contextKey,
      context: context || null,
    });

    const applyType = job.applyType ? String(job.applyType).slice(0, 50) : null;

    const row = existingByJobId.get(job.id);
    if (row) {
      const rowUpdates = { ApplyPriorityJson: applyPriorityJson };
      // backfill ApplyType for rows created before it was persisted
      if (!String(row.ApplyType || '').trim() && applyType) rowUpdates.ApplyType = applyType;
      await row.update(rowUpdates);
      updatedCount += 1;
      continue;
    }

    await models.Applications.create({
      UserId: clientUserId,
      VacancyTitle: (job.title || `Screenly #${job.id}`).slice(0, 255),
      CompanyName: job.company ? job.company.slice(0, 255) : null,
      Source: job.source ? job.source.slice(0, 50) : null,
      ApplyType: applyType,
      ScreenlyJobId: job.id,
      Status: 'new',
      AppliedAt: new Date(),
      MetaJson: JSON.stringify({
        positionId: job.id,
        applyUrl: job.applyUrl,
        location: job.location,
        shortSummary: job.shortSummary,
        createdBy: 'agent-apply-priority',
      }),
      ApplyPriorityJson: applyPriorityJson,
    });
    createdCount += 1;
  }

  return { createdCount, updatedCount, total: createdCount + updatedCount };
}
