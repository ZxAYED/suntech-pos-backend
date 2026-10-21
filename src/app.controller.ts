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
    summary: '[PUBLIC] Health check probe',
    description:
      'Returns base system health status. No authentication required.',
  })
  @ApiResponse({ status: 200, description: 'Service is running' })
  @ResponseMessage('Service is running')
  getHello(): Record<string, unknown> {
    return this.appService.getHello();
  }
}
