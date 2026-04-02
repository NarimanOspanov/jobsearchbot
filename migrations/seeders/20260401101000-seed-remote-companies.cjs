'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const companies = [
      { Name: '1Password', Url: 'https://1password.com/careers' },
      { Name: '3Cloud', Url: 'https://3cloudsolutions.com/careers' },
      { Name: 'Airalo', Url: 'https://www.airalo.com/careers' },
      { Name: 'Airbnb', Url: 'https://careers.airbnb.com' },
      { Name: 'Apollo', Url: 'https://www.apollo.io/careers' },
      { Name: 'Ashby', Url: 'https://www.ashbyhq.com/careers' },
      { Name: 'Attio', Url: 'https://attio.com/careers' },
      { Name: 'Automattic', Url: 'https://automattic.com/work-with-us' },
      { Name: 'Canonical', Url: 'https://canonical.com/careers' },
      { Name: 'Circle', Url: 'https://www.circle.com/en/careers' },
      { Name: 'ClickUp (Remote US)', Url: 'https://clickup.com/careers' },
      { Name: 'CloudLinux', Url: 'https://www.cloudlinux.com/careers' },
      { Name: 'Deel', Url: 'https://www.deel.com/careers' },
      { Name: 'Finom', Url: 'https://careers.finom.co' },
      { Name: 'GitLab', Url: 'https://about.gitlab.com/jobs' },
      { Name: 'Libertex Group', Url: 'https://libertexgroup.com/careers' },
      { Name: 'LiveKit (Remote US)', Url: 'https://livekit.io/careers' },
      { Name: 'Mercuryo', Url: 'https://mercuryo.io/career' },
      { Name: 'Paychex', Url: 'https://www.paychex.com/careers' },
      { Name: 'Playrix', Url: 'https://playrix.com/careers' },
      { Name: 'PostHog', Url: 'https://posthog.com/careers' },
      { Name: 'RubyLabs', Url: 'https://rubylabs.com/careers' },
      { Name: 'Skyro', Url: 'https://skyro.pro/careers' },
      { Name: 'Snoonu', Url: 'https://snoonu.com/careers' },
      { Name: 'Tabby', Url: 'https://tabby.ai/careers' },
      { Name: 'Termius', Url: 'https://termius.com/careers' },
      { Name: 'Torrero', Url: 'https://torrero.com/careers' },
      { Name: 'Veeam', Url: 'https://careers.veeam.com' },
      { Name: 'Yazio', Url: 'https://www.yazio.com/en/jobs' },
      { Name: 'Zapier', Url: 'https://zapier.com/jobs' },
    ];

    for (const item of companies) {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT TOP 1 Id
         FROM dbo.RemoteCompanies
         WHERE Url = :url`,
        { replacements: { url: item.Url } }
      );
      if (rows.length > 0) continue;
      await queryInterface.bulkInsert({ tableName: 'RemoteCompanies', schema: 'dbo' }, [{
        Name: item.Name,
        Url: item.Url,
        DateAdded: now,
      }]);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(
      { tableName: 'RemoteCompanies', schema: 'dbo' },
      { Url: { [Sequelize.Op.in]: [
        'https://1password.com/careers',
        'https://3cloudsolutions.com/careers',
        'https://www.airalo.com/careers',
        'https://careers.airbnb.com',
        'https://www.apollo.io/careers',
        'https://www.ashbyhq.com/careers',
        'https://attio.com/careers',
        'https://automattic.com/work-with-us',
        'https://canonical.com/careers',
        'https://www.circle.com/en/careers',
        'https://clickup.com/careers',
        'https://www.cloudlinux.com/careers',
        'https://www.deel.com/careers',
        'https://careers.finom.co',
        'https://about.gitlab.com/jobs',
        'https://libertexgroup.com/careers',
        'https://livekit.io/careers',
        'https://mercuryo.io/career',
        'https://www.paychex.com/careers',
        'https://playrix.com/careers',
        'https://posthog.com/careers',
        'https://rubylabs.com/careers',
        'https://skyro.pro/careers',
        'https://snoonu.com/careers',
        'https://tabby.ai/careers',
        'https://termius.com/careers',
        'https://torrero.com/careers',
        'https://careers.veeam.com',
        'https://www.yazio.com/en/jobs',
        'https://zapier.com/jobs',
      ] } }
    );
  },
};
