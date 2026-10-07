import { EmailTemplateService } from './email-template.service';

describe('EmailTemplateService', () => {
  const service = new EmailTemplateService();

  it('renders a branded SunTech reset email', () => {
    const html = service.renderPasswordReset({
      fullName: 'Amina Rahman',
      email: 'amina@shop.test',
      otp: '123456',
    });

    expect(html).toContain('#F4F6F8');
    expect(html).toContain('#070B28');
    expect(html).toContain('#0052FF');
    expect(html).toContain('Sun');
    expect(html).toContain('Tech');
    expect(html).toContain('123456');
    expect(html).toContain('image_0057bd.png');
    expect(html).not.toContain('<script');
  });
});
