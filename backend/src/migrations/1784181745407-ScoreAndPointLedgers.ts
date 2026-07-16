import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScoreAndPointLedgers1784181745407 implements MigrationInterface {
  name = 'ScoreAndPointLedgers1784181745407';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "claim_score_events" ("id" SERIAL NOT NULL, "userId" uuid, "team" character varying(2) NOT NULL, "spotId" integer, "score" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c0fad2610afa94dac3331eb5afb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b39198e09443ef239ec5f7867" ON "claim_score_events"  ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f45e5c9b48d1c8ced534ed5e2" ON "claim_score_events"  ("team", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."point_events_source_enum" AS ENUM('CLAIM', 'IAP', 'AD')`,
    );
    await queryRunner.query(
      `CREATE TABLE "point_events" ("id" SERIAL NOT NULL, "userId" uuid, "source" "public"."point_events_source_enum" NOT NULL, "amount" integer NOT NULL, "refId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_14cbd6b4e90db5df8728df1ce94" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de27598669655ee46f55843ab0" ON "point_events"  ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_score_events" ADD CONSTRAINT "FK_71b68b81987f08d00590201b58a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_score_events" ADD CONSTRAINT "FK_df36e595a039ffea318c43301a6" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "point_events" ADD CONSTRAINT "FK_d89e93d24fd1d04b88456b61d57" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "point_events" DROP CONSTRAINT "FK_d89e93d24fd1d04b88456b61d57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_score_events" DROP CONSTRAINT "FK_df36e595a039ffea318c43301a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_score_events" DROP CONSTRAINT "FK_71b68b81987f08d00590201b58a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de27598669655ee46f55843ab0"`,
    );
    await queryRunner.query(`DROP TABLE "point_events"`);
    await queryRunner.query(`DROP TYPE "public"."point_events_source_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f45e5c9b48d1c8ced534ed5e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b39198e09443ef239ec5f7867"`,
    );
    await queryRunner.query(`DROP TABLE "claim_score_events"`);
  }
}
