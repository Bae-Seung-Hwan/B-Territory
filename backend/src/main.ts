import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { apiDocsEnabled, configureApp } from './app-setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  // 조건부로 등록한다 — 등록 자체를 건너뛰면 /api/docs와 /api/docs-json 둘 다 404가 된다.
  // (앞단에서 경로를 막는 방식은 Caddy 설정이 갈리거나 컨테이너를 직접 노출하는 순간
  //  다시 열리므로, 앱이 스스로 안 붙이는 쪽이 확실하다.)
  const docsEnabled = apiDocsEnabled();
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('B-Territory API')
      .setDescription('관광지 점령 게임 B-Territory 백엔드 API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(
    docsEnabled
      ? `Swagger docs: http://localhost:${port}/api/docs`
      : 'Swagger docs: 비활성화됨 (ENABLE_API_DOCS=true로 켤 수 있음)',
  );
}
void bootstrap();
