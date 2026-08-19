import { MigrationInterface, QueryRunner } from 'typeorm';

export class Festivals1785900000000 implements MigrationInterface {
  name = 'Festivals1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "festivals" ("id" SERIAL NOT NULL, "contentId" character varying NOT NULL, "title" character varying NOT NULL, "addr1" character varying, "mapX" numeric(13,10), "mapY" numeric(13,10), "firstimage" character varying, "tel" character varying, "eventStartDate" date NOT NULL, "eventEndDate" date NOT NULL, "areacode" character varying, "sigungucode" character varying, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_festivals_contentId" UNIQUE ("contentId"), CONSTRAINT "PK_festivals" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_festivals_start" ON "festivals" ("eventStartDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_festivals_end" ON "festivals" ("eventEndDate")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_festivals_end"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_festivals_start"`);
    await queryRunner.query(`DROP TABLE "festivals"`);
  }
}
