'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const [existingUsers] = await queryInterface.sequelize.query(
      "SELECT TOP 1 Id FROM dbo.Users ORDER BY Id ASC"
    );

    let userId = existingUsers?.[0]?.Id;
    if (!userId) {
      const [inserted] = await queryInterface.sequelize.query(
        `INSERT INTO dbo.Users
          (TelegramUserName, TelegramChatId, DateJoined, IsBlocked, HhEnabled, LinkedInEnabled, IndeedEnabled, CompanySitesEnabled, EmailFoundersEnabled, EmailRecruitersEnabled, SearchMode, MinimumSalary)
         OUTPUT INSERTED.Id
         VALUES
          ('seed_user', 999000111, GETUTCDATE(), 0, 1, 1, 1, 1, 1, 1, 'not_urgent', 3000)`
      );
      userId = inserted?.[0]?.Id;
    }

    const statuses = ['applied', 'interview', 'rejected', 'offer'];
    const sources = ['headhunter', 'linkedin', 'indeed', 'company_site', 'founder_email', 'recruiter_email'];
    const companies = ['Uber', 'Stripe', 'Notion', 'Figma', 'Datadog', 'Miro', 'Revolut', 'Wise', 'GitLab', 'Linear'];
    const roles = ['Backend Engineer', 'Fullstack Engineer', 'Data Engineer', 'ML Engineer', 'DevOps Engineer'];

    const rows = [];
    for (let i = 0; i < 25; i++) {
      const appliedAt = new Date(now.getTime() - i * 6 * 60 * 60 * 1000);
      rows.push({
        UserId: userId,
        VacancyTitle: roles[i % roles.length],
        CompanyName: companies[i % companies.length],
        Source: sources[i % sources.length],
        Status: statuses[i % statuses.length],
        AppliedAt: appliedAt,
        Notes: `Seeded application #${i + 1}`,
        MetaJson: JSON.stringify({ seed: true, rank: i + 1 }),
      });
    }

    await queryInterface.bulkInsert({ tableName: 'Applications', schema: 'dbo' }, rows);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(
      { tableName: 'Applications', schema: 'dbo' },
      { Notes: { [Sequelize.Op.like]: 'Seeded application #%'} }
    );
  },
};
