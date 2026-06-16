import { DataTypes } from 'sequelize';

export default function defineClientMentor(sequelize) {
  const ClientMentor = sequelize.define(
    'ClientMentor',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      MentorUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ClientUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'ClientMentors',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['MentorUserId'] },
        { unique: true, fields: ['MentorUserId', 'ClientUserId'] },
      ],
    }
  );

  return ClientMentor;
}
