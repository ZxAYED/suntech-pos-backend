import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transport = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.configService.getOrThrow<string>('SMTP_PORT')),
      secure: false,
      auth: {
        user: this.configService.getOrThrow<string>('SMTP_USER'),
        pass: this.configService.getOrThrow<string>('SMTP_PASS'),
      },
    });
  }

  async deliver(message: OutboundMail): Promise<void> {
    const from = this.configService.getOrThrow<string>('MAIL_FROM');

    await this.transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });

    this.logger.log(`Sent "${message.subject}" to ${message.to}`);
  }
}
