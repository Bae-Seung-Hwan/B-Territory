import { MigrationInterface, QueryRunner } from 'typeorm';

export class Missions1785950000000 implements MigrationInterface {
  name = 'Missions1785950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 미션 보너스 점수 이벤트 타입 추가 (개인 점수 전용)
    await queryRunner.query(
      `ALTER TYPE "public"."score_events_type_enum" ADD VALUE IF NOT EXISTS 'MISSION_PHOTO'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."score_events_type_enum" ADD VALUE IF NOT EXISTS 'MISSION_REVIEW'`,
    );

    await queryRunner.query(
      `CREATE TABLE "reviews" ("id" SERIAL NOT NULL, "userId" uuid, "team" character varying(2) NOT NULL, "spotId" integer NOT NULL, "rating" integer NOT NULL, "content" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_reviews" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c57ce699daa4d290952ce9906" ON "reviews" ("spotId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_7ed5659e7139fc8bc039198cc1f" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_f007c312fa67da681bee04f39df" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "mission_photos" ("id" SERIAL NOT NULL, "userId" uuid, "team" character varying(2) NOT NULL, "spotId" integer NOT NULL, "imageUrl" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mission_photos" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6762a7d51d81722666ed758bce" ON "mission_photos" ("spotId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" ADD CONSTRAINT "FK_bd49af4056a8bfb623c2939d999" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" ADD CONSTRAINT "FK_ec85a311434b9013f45b2be0437" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mission_photos" DROP CONSTRAINT "FK_ec85a311434b9013f45b2be0437"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" DROP CONSTRAINT "FK_bd49af4056a8bfb623c2939d999"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6762a7d51d81722666ed758bce"`,
    );
    await queryRunner.query(`DROP TABLE "mission_photos"`);

    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_f007c312fa67da681bee04f39df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_7ed5659e7139fc8bc039198cc1f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c57ce699daa4d290952ce9906"`,
    );
    await queryRunner.query(`DROP TABLE "reviews"`);

    // enum 값 제거는 Postgres가 지원하지 않아 down에서 되돌리지 않는다(신규 타입 추가만 롤백 불가).
  }
}
