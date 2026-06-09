import { DataTypes } from 'sequelize';

export default function definePublisherSignup(sequelize) {
  const PublisherSignup = sequelize.define(
    'PublisherSignup',
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
      Publisher: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      PublishedIn: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      PositionId: {
        type: DataTypes.UUID,
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
      tableName: 'PublisherSignups',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['UserId'] },
        { fields: ['Publisher', 'PublishedIn', 'SignedUpAt'] },
        { fields: ['PositionId', 'SignedUpAt'] },
      ],
    }
  );

  return PublisherSignup;
}
