import { DataTypes } from 'sequelize';

export default function defineCampaignSignup(sequelize) {
  const CampaignSignup = sequelize.define(
    'CampaignSignup',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      CampaignSlug: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      StartPayload: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      SignedUpAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'CampaignSignups',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['UserId'] },
        { fields: ['CampaignSlug', 'SignedUpAt'] },
      ],
    }
  );

  return CampaignSignup;
}
