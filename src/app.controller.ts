import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from './common/decorators/response-message.decorator';
import { AppService } from './app.service';

@ApiTags('Health & Status')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check probe',
    description: 'Returns base system health status.',
  })
  @ApiResponse({ status: 200, description: 'Service is running' })
  @ResponseMessage('Service is running')
  getHello(): string {
    return this.appService.getHello();
  }
}
