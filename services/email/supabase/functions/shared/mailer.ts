export interface EmailAddress {
    address: string;
    name?: string;
}

export interface EmailAttachment {
    filename: string;
    content: string; // base64 encoded content
    contentType: string;
    contentId?: string; // for inline attachments
}

export interface EmailMessage {
    from: EmailAddress;
    to: EmailAddress[];
    subject: string;
    htmlbody: string;
    textbody: string;
    attachments?: EmailAttachment[];
}

export interface SmtpConfig {
    fromEmail: string;
    hostname: string;
    port: number;
    username: string;
    password: string;
    tls: boolean;
}

export class SmtpMailSender {
    private config: SmtpConfig;

    constructor(config?: Partial<SmtpConfig>) {
        this.config = {
            fromEmail: config?.fromEmail || Deno.env.get('FROM_EMAIL') || '"Cebby" <no-reply@getcebby.com>',
            hostname: config?.hostname || Deno.env.get('SMTP_HOSTNAME') || 'smtp.zeptomail.com',
            port: config?.port || parseInt(Deno.env.get('SMTP_PORT') || '465'),
            username: config?.username || Deno.env.get('SMTP_USER') || 'emailapikey',
            password: config?.password || Deno.env.get('SMTP_PASS') || '',
            tls: config?.tls || (Deno.env.get('SMTP_TLS') !== 'false'),
        };
    }

    private parseFromEmail(fromEmail: string): EmailAddress {
        if (fromEmail.includes('<')) {
            const nameMatch = fromEmail.match(/^"?([^"]*)"?\s*</);
            const addressMatch = fromEmail.match(/<(.+)>/);
            return {
                address: addressMatch?.[1] || fromEmail,
                name: nameMatch?.[1] || 'Cebby',
            };
        }
        return {
            address: fromEmail,
            name: 'Cebby',
        };
    }

    private formatEmail(addr: EmailAddress): string {
        return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address;
    }

    private encodeBase64(str: string): string {
        return btoa(str);
    }

    async sendEmail(
        message: Omit<EmailMessage, 'from'>,
    ): Promise<{ success: boolean; requestId?: string; error?: string }> {
        try {
            if (!this.config.username || !this.config.password) {
                console.log('=📝 Email content prepared (SMTP credentials not configured):');
                console.log('=👥 To:', message.to.map((t) => t.address).join(', '));
                console.log('=📋 Subject:', message.subject);
                console.log('=⚙️ Configure SMTP_USERNAME and SMTP_PASSWORD to send actual emails');

                return { success: true };
            }

            console.log('📤 Sending email via SMTP to:', message.to.map((t) => t.address).join(', '));

            const fromAddress = this.parseFromEmail(this.config.fromEmail);

            // Connect to SMTP server
            const conn = await Deno.connect({
                hostname: this.config.hostname,
                port: this.config.port,
            });

            if (this.config.tls && this.config.port === 465) {
                // Start TLS connection for implicit TLS (port 465)
                const tlsConn = await Deno.startTls(conn, { hostname: this.config.hostname });
                await this.sendSmtpCommands(tlsConn, fromAddress, message);
                tlsConn.close();
            } else {
                await this.sendSmtpCommands(conn, fromAddress, message);
                conn.close();
            }

            console.log('✅ Email sent successfully via SMTP');
            return { success: true, requestId: new Date().getTime().toString() };
        } catch (error) {
            console.error('⚠️ Error sending email:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
        }
    }

    private async sendSmtpCommands(conn: Deno.Conn, fromAddress: EmailAddress, message: Omit<EmailMessage, 'from'>) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Helper to send command and read response
        const sendCommand = async (command: string): Promise<string> => {
            await conn.write(encoder.encode(command + '\r\n'));
            const buffer = new Uint8Array(1024);
            const bytesRead = await conn.read(buffer);
            return decoder.decode(buffer.subarray(0, bytesRead || 0));
        };

        // SMTP conversation
        await sendCommand(`EHLO ${this.config.hostname}`);
        await sendCommand(`AUTH LOGIN`);
        await sendCommand(this.encodeBase64(this.config.username));
        await sendCommand(this.encodeBase64(this.config.password));

        await sendCommand(`MAIL FROM:<${fromAddress.address}>`);

        for (const to of message.to) {
            await sendCommand(`RCPT TO:<${to.address}>`);
        }

        await sendCommand('DATA');

        // Email headers and body
        const boundary = message.attachments && message.attachments.length > 0 ? 'mixed-boundary123' : 'boundary123';
        const altBoundary = 'alt-boundary123';
        
        const emailParts = [
            `From: ${this.formatEmail(fromAddress)}`,
            `To: ${message.to.map((to) => this.formatEmail(to)).join(', ')}`,
            `Subject: ${message.subject}`,
            'MIME-Version: 1.0',
        ];

        if (message.attachments && message.attachments.length > 0) {
            emailParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
            emailParts.push('');
            emailParts.push(`--${boundary}`);
            emailParts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
            emailParts.push('');
            emailParts.push(`--${altBoundary}`);
            emailParts.push('Content-Type: text/plain; charset=UTF-8');
            emailParts.push('');
            emailParts.push(message.textbody);
            emailParts.push('');
            emailParts.push(`--${altBoundary}`);
            emailParts.push('Content-Type: text/html; charset=UTF-8');
            emailParts.push('');
            emailParts.push(message.htmlbody);
            emailParts.push('');
            emailParts.push(`--${altBoundary}--`);
            
            // Add attachments
            for (const attachment of message.attachments) {
                emailParts.push('');
                emailParts.push(`--${boundary}`);
                emailParts.push(`Content-Type: ${attachment.contentType}`);
                emailParts.push(`Content-Transfer-Encoding: base64`);
                emailParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
                if (attachment.contentId) {
                    emailParts.push(`Content-ID: <${attachment.contentId}>`);
                }
                emailParts.push('');
                // Split base64 content into lines of 76 characters (RFC 2045)
                const lines = attachment.content.match(/.{1,76}/g) || [];
                emailParts.push(...lines);
            }
            
            emailParts.push('');
            emailParts.push(`--${boundary}--`);
        } else {
            emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
            emailParts.push('');
            emailParts.push(`--${boundary}`);
            emailParts.push('Content-Type: text/plain; charset=UTF-8');
            emailParts.push('');
            emailParts.push(message.textbody);
            emailParts.push('');
            emailParts.push(`--${boundary}`);
            emailParts.push('Content-Type: text/html; charset=UTF-8');
            emailParts.push('');
            emailParts.push(message.htmlbody);
            emailParts.push('');
            emailParts.push(`--${boundary}--`);
        }
        
        emailParts.push('');
        emailParts.push('.');
        
        const emailData = emailParts.join('\r\n');
        await sendCommand(emailData);
        await sendCommand('QUIT');
    }
}

export const defaultMailer = new SmtpMailSender();

export function sendEmail(
    message: Omit<EmailMessage, 'from'>,
): Promise<{ success: boolean; requestId?: string; error?: string }> {
    return defaultMailer.sendEmail(message);
}
