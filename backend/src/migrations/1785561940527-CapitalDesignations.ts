import { MigrationInterface, QueryRunner } from 'typeorm';

export class CapitalDesignations1785561940527 implements MigrationInterface {
  name = 'CapitalDesignations1785561940527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "capital_designations" ("id" SERIAL NOT NULL, "sigunguCode" character varying NOT NULL, "weekStart" TIMESTAMP WITH TIME ZONE NOT NULL, "designatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1f821dd581d3863c9a2fb1ad1e" UNIQUE ("weekStart"), CONSTRAINT "PK_1fb5e5b6417fa8be7f18098323d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e5bc6a729fb5f69169eecff37" ON "capital_designations"  ("designatedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e5bc6a729fb5f69169eecff37"`,
    );
    await queryRunner.query(`DROP TABLE "capital_designations"`);
  }
}
