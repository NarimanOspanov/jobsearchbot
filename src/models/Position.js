import { DataTypes } from 'sequelize';

export default function definePosition(sequelize) {
  const Position = sequelize.define(
    'Position',
    {
      Id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      Title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      Description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      CompanyName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      CompanyWebsite: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },
      ExternalApplyURL: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      DateCreated: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      IsArchived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
    },
    {
      tableName: 'Positions',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['DateCreated'] },
        { fields: ['IsArchived', 'DateCreated'] },
      ],
    }
  );

  return Position;
}
