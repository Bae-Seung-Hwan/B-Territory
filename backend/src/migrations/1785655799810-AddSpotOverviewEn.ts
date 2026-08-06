import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpotOverviewEn1785655799810 implements MigrationInterface {
  name = 'AddSpotOverviewEn1785655799810';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spots" ADD "overviewEn" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "spots" DROP COLUMN "overviewEn"`);
  }
}
