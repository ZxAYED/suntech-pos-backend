import { Module } from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';
import { IdGeneratorService } from './id-generator.service';

@Module({
  providers: [IdGeneratorService, EmailTemplateService],
  exports: [IdGeneratorService, EmailTemplateService],
})
export class IdentityModule {}
