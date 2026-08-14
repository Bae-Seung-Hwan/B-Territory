import { MigrationInterface, QueryRunner } from 'typeorm';

export class CapitalDesignations1785561940527 implements MigrationInterface {
  name = 'CapitalDesignations1785561940527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "capital_designations" ("id" SERIAL NOT NULL, "sigunguCode" character varying NOT NULL, "weekStart" TIMESTAMP WITH TIME ZONE NOT NULL, "designatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1f821dd581d3863c9a2fb1ad1e2" UNIQUE ("weekStart"), CONSTRAINT "PK_1fb5e5b6417fa8be7f18098323d" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "capital_designations"`);
  }
}
