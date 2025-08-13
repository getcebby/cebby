// Modern email template for Cebby registration confirmations

export function createEmailTemplate(
  registration: any,
  event: any,
  eventDate: string,
  eventUrl: string,
): { html: string; text: string } {
  const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>Registration Confirmed - ${event.name}</title>
        <!--[if mso]>
        <noscript>
          <xml>
            <o:OfficeDocumentSettings>
              <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
          </xml>
        </noscript>
        <![endif]-->
        <style>
          /* Reset styles */
          body, table, td, p, a, li, blockquote {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          table, td {
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
          }
          img {
            -ms-interpolation-mode: bicubic;
            border: 0;
            height: auto;
            line-height: 100%;
            outline: none;
            text-decoration: none;
          }
  
          /* Base styles */
          body {
            margin: 0 !important;
            padding: 0 !important;
            background-color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
          }
          
          /* Header styles */
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 30px;
            text-align: center;
          }
          
          .header h1 {
            color: #ffffff;
            font-size: 28px;
            font-weight: 700;
            margin: 0;
            line-height: 1.2;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .header .emoji {
            font-size: 32px;
            margin-left: 8px;
          }
          
          /* Content styles */
          .content {
            padding: 40px 30px;
            line-height: 1.6;
            color: #374151;
          }
          
          .greeting {
            font-size: 18px;
            color: #1f2937;
            margin-bottom: 20px;
            font-weight: 500;
          }
          
          .message {
            font-size: 16px;
            margin-bottom: 30px;
          }
          
          /* Event details card */
          .event-card {
            background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
            border-radius: 12px;
            padding: 24px;
            margin: 30px 0;
            border-left: 4px solid #667eea;
          }
          
          .event-card h3 {
            color: #1f2937;
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 16px 0;
          }
          
          .event-detail {
            margin-bottom: 12px;
            font-size: 15px;
          }
          
          .event-detail strong {
            color: #1f2937;
            font-weight: 600;
            display: inline-block;
            min-width: 80px;
          }
          
          .event-name {
            font-size: 20px;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 8px;
          }
          
          /* Button styles */
          .button-container {
            text-align: center;
            margin: 35px 0;
          }
          
          .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff !important;
            text-decoration: none;
            padding: 16px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          }
          
          .cta-button:hover {
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
            transform: translateY(-1px);
          }
          
          /* Status badge */
          .status-badge {
            display: inline-block;
            background-color: #10b981;
            color: #ffffff;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 20px;
          }
          
          /* Footer */
          .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
          }
          
          .footer-content {
            font-size: 14px;
            color: #6b7280;
            line-height: 1.5;
          }
          
          .company-name {
            font-weight: 600;
            color: #374151;
          }
          
          /* Responsive */
          @media only screen and (max-width: 600px) {
            .email-container {
              width: 100% !important;
            }
            
            .header, .content, .footer {
              padding: 20px !important;
            }
            
            .header h1 {
              font-size: 24px !important;
            }
            
            .event-card {
              padding: 20px !important;
            }
            
            .cta-button {
              padding: 14px 24px !important;
              font-size: 15px !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <!-- Header -->
          <div class="header">
            <h1>Registration Confirmed<span class="emoji">🎉</span></h1>
          </div>
          
          <!-- Main Content -->
          <div class="content">
            <div class="status-badge">✓ Confirmed</div>
            
            <div class="greeting">Hi ${registration.name},</div>
            
            <div class="message">
              Thank you for registering for <strong>${event.name}</strong>! Your spot is confirmed and we're excited to see you there.
            </div>
            
            <!-- Event Details Card -->
            <div class="event-card">
              <h3>📅 Event Details</h3>
              <div class="event-name">${event.name}</div>
              <div class="event-detail">
                <strong>📅 Date:</strong> ${eventDate}
              </div>
              ${
    event.location
      ? `
              <div class="event-detail">
                <strong>📍 Location:</strong> ${event.location}
              </div>
              `
      : ""
  }
              ${
    event.description
      ? `
              <div class="event-detail">
                <strong>📝 About:</strong> ${event.description}
              </div>
              `
      : ""
  }
            </div>
            
            <!-- Call to Action -->
            <div class="button-container">
              <a href="${eventUrl}" class="cta-button">View Event Details</a>
            </div>
            
            <div class="message">
              <p><strong>What's next?</strong></p>
              <p>• Save the date in your calendar<br>
              • We'll send you a reminder before the event<br>
              • Feel free to reach out if you have any questions</p>
            </div>
            
            <div class="message">
              Looking forward to seeing you at the event!
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Best regards,</strong><br>
              <span class="company-name">The Cebby Team</span></p>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="footer">
            <div class="footer-content">
              <p style="margin: 0 0 8px 0;">This email was sent because you registered for an event on Cebby.</p>
              <p style="margin: 0; font-size: 12px;">If you didn't register for this event, please ignore this email.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

  const text = `
  🎉 REGISTRATION CONFIRMED
  
  Hi ${registration.name},
  
  Thank you for registering for ${event.name}! Your spot is confirmed and we're excited to see you there.
  
  📅 EVENT DETAILS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  Event: ${event.name}
  Date: ${eventDate}${
    event.location
      ? `
  Location: ${event.location}`
      : ""
  }${
    event.description
      ? `
  About: ${event.description}`
      : ""
  }
  
  WHAT'S NEXT?
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  • Save the date in your calendar
  • We'll send you a reminder before the event  
  • Feel free to reach out if you have any questions
  
  View full event details: ${eventUrl}
  
  Looking forward to seeing you at the event!
  
  Best regards,
  The Cebby Team
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  This email was sent because you registered for an event on Cebby.
  If you didn't register for this event, please ignore this email.
    `;

  return { html, text };
}
