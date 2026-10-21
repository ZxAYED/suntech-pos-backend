import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): {
    name: string;
    version: string;
    status: string;
    message: string;
    docs: string;
    apiBase: string;
    timestamp: string;
  } {
    return {
      name: 'SunTech POS Backend API',
      version: '1.0.0',
      status: 'online',
      message: 'Welcome to SunTech POS System!',
      docs: '/api/docs',
      apiBase: '/api/v1',
      timestamp: new Date().toISOString(),
    };
  }
}
