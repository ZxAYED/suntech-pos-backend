import { Injectable, Logger } from '@nestjs/common';

export interface PasswordResetEmailInput {
  fullName: string;
  email: string;
  otp: string;
}

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  sendPasswordReset(input: PasswordResetEmailInput): void {
    const html = this.renderPasswordReset(input);

    this.logger.log(`Password reset email for ${input.email}\n${html}`);
  }

  renderPasswordReset(input: PasswordResetEmailInput): string {
    const name = escapeHtml(input.fullName);
    const otp = escapeHtml(input.otp);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SunTech password reset</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F6F8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="height:6px;background:#0052FF;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <!-- Header logo: image_0057bd.png -->
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1;font-weight:700;letter-spacing:-0.04em;color:#070B28;">
                  Sun<span style="color:#0052FF;">Tech</span>
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#0052FF;margin-top:8px;">
                  Point of Sale
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;color:#070B28;">
                <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:#070B28;">Reset your password</h1>
                <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:#070B28;">Hi ${name},</p>
                <p style="margin:8px 0 0 0;font-size:15px;line-height:1.6;color:#070B28;">Use this code to choose a new SunTech password. It expires in 15 minutes.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px;">
                <div style="display:inline-block;background:#F4F6F8;border-radius:12px;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:1;font-weight:700;letter-spacing:0.35em;color:#0052FF;">
                  ${otp}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#070B28;">
                If you did not ask for this code, you can ignore this email. Your password will stay the same.
              </td>
            </tr>
          </table>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#070B28;opacity:0.7;margin:16px 0 0 0;">SunTech POS</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
