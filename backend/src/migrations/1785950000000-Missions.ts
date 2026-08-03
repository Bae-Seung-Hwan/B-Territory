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
      `CREATE TABLE "reviews" ("id" SERIAL NOT NULL, "userId" uuid NOT NULL, "team" character varying(2) NOT NULL, "spotId" integer NOT NULL, "rating" integer NOT NULL, "content" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_reviews" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reviews_spot_created" ON "reviews" ("spotId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_reviews_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_reviews_spot" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "mission_photos" ("id" SERIAL NOT NULL, "userId" uuid NOT NULL, "team" character varying(2) NOT NULL, "spotId" integer NOT NULL, "imageUrl" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mission_photos" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mission_photos_spot_created" ON "mission_photos" ("spotId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" ADD CONSTRAINT "FK_mission_photos_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" ADD CONSTRAINT "FK_mission_photos_spot" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mission_photos" DROP CONSTRAINT "FK_mission_photos_spot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mission_photos" DROP CONSTRAINT "FK_mission_photos_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_mission_photos_spot_created"`,
    );
    await queryRunner.query(`DROP TABLE "mission_photos"`);

    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_reviews_spot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_reviews_user"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_reviews_spot_created"`);
    await queryRunner.query(`DROP TABLE "reviews"`);

    // enum 값 제거는 Postgres가 지원하지 않아 down에서 되돌리지 않는다(신규 타입 추가만 롤백 불가).
  }
}
