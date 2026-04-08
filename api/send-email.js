import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Resend API key not configured' });

  try {
    const { to, name, company, riskLevel, riskScore, gaps, industry } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing recipient email' });

    let portalLink = 'https://audit.theaiinsurancegroup.com';
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const token = Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
        const { data: audit } = await supabase.from('audits').insert({
          client_name: company || name || 'Assessment Lead',
          client_industry: industry || 'Other',
          client_contact: name || '',
          client_email: to,
          status: 'DRAFT',
          file_count: 0,
          client_token: token,
        }).select().single();
        if (audit) {
          portalLink = 'https://audit.theaiinsurancegroup.com?token=' + token;
          await supabase.from('activity_log').insert({
            audit_id: audit.id,
            action: 'AUTO_CREATED_FROM_ASSESSMENT',
            details: { name, company, riskLevel, riskScore, email: to },
            actor: 'system',
          });
        }
      } catch (dbErr) {
        console.error('DB error:', dbErr);
      }
    }

    const riskColor = riskLevel === 'HIGH' ? '#DC2626' : riskLevel === 'MODERATE' ? '#EA580C' : '#16A34A';
    const riskBg = riskLevel === 'HIGH' ? '#FEF2F2' : riskLevel === 'MODERATE' ? '#FFFBEB' : '#F0FDF4';
    const riskEmoji = riskLevel === 'HIGH' ? '🔴' : riskLevel === 'MODERATE' ? '🟡' : '🟢';

    const gapsList = (gaps || []).map(g =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:14px;color:#333;">✗ ${g}</td></tr>`
    ).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F8F6F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#1A2B45;border-radius:12px 12px 0 0;padding:32px 28px;text-align:center;">
      <div style="color:#B8972A;font-size:13px;font-weight:700;letter-spacing:2px;margin-bottom:4px;">THE AI INSURANCE GROUP</div>
      <div style="color:#ffffff;font-size:22px;font-weight:700;">Your AI Coverage Gap Assessment Results</div>
    </div>
    <div style="background:${riskBg};padding:24px 28px;text-align:center;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
      <div style="font-size:14px;color:#6B7280;margin-bottom:8px;">Your AI Liability Exposure Level</div>
      <div style="font-size:36px;font-weight:800;color:${riskColor};">${riskEmoji} ${riskLevel || 'MODERATE'} RISK</div>
      ${riskScore ? `<div style="font-size:13px;color:#6B7280;margin-top:4px;">Risk Score: ${riskScore}/100</div>` : ''}
    </div>
    <div style="background:#ffffff;padding:28px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
      <p style="font-size:15px;color:#1A2B45;line-height:1.7;margin:0 0 16px;">
        ${name ? name + ', thank' : 'Thank'} you for completing the AI Coverage Gap Assessment.
      </p>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">
        Based on your responses, your organization has <strong style="color:${riskColor};">${(riskLevel || 'moderate').toLowerCase()}-level AI liability exposure</strong>. 
        This means your current insurance policies may not adequately cover risks related to your use of artificial intelligence.
      </p>
      ${gapsList ? `
      <div style="margin:20px 0;">
        <div style="font-size:13px;font-weight:700;color:#B8972A;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Potential Coverage Gaps Identified</div>
        <table style="width:100%;border-collapse:collapse;background:#FAFAFA;border-radius:8px;overflow:hidden;">
          ${gapsList}
        </table>
      </div>
      ` : ''}
      <p style="font-size:15px;color:#333;line-height:1.7;margin:20px 0;">
        As of January 2026, major carriers including W.R. Berkley, Cincinnati Financial, and others have added explicit AI exclusions to commercial policies. Many businesses are exposed without knowing it.
      </p>
      <div style="background:#F8F6F1;border-radius:8px;padding:24px;text-align:center;margin:24px 0;border:1px solid #E5E7EB;">
        <div style="font-size:18px;font-weight:700;color:#1A2B45;margin-bottom:8px;">Get Your Full AI Coverage Audit</div>
        <p style="font-size:14px;color:#6B7280;margin:0 0 16px;line-height:1.6;">
          Upload your commercial policies using the secure link below. Our AI will scan every page for exclusions, sublimits, and gaps — with a validated report ready for your next renewal.
        </p>
        <a href="${portalLink}" 
           style="display:inline-block;background:#B8972A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
          Upload Your Policies →
        </a>
        <p style="font-size:12px;color:#6B7280;margin:12px 0 0;">This is your personal secure link. No account or password needed.</p>
      </div>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:20px 0 0;">
        A specialist from our team will also reach out within 24 hours to review your results personally. If you'd like to speak sooner, reply to this email or contact us at 
        <a href="mailto:sal@theaiinsurancegroup.com" style="color:#B8972A;text-decoration:none;font-weight:600;">sal@theaiinsurancegroup.com</a>.
      </p>
    </div>
    <div style="background:#F8F6F1;padding:24px 28px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
      <div style="font-size:15px;font-weight:700;color:#1A2B45;">Sal Martorano</div>
      <div style="font-size:13px;color:#6B7280;">Founder, The AI Insurance Group</div>
      <div style="font-size:13px;color:#6B7280;margin-top:4px;">
        <a href="https://theaiinsurancegroup.com" style="color:#B8972A;text-decoration:none;">theaiinsurancegroup.com</a>
      </div>
    </div>
    <div style="background:#1A2B45;border-radius:0 0 12px 12px;padding:20px 28px;text-align:center;">
      <div style="font-size:11px;color:rgba(255,255,255,0.4);line-height:1.6;">
        © 2026 The AI Insurance Group. All rights reserved.<br>
        Insurance products placed through licensed insurance brokers.<br>
        The AI Insurance Group is a marketing and informational platform.
      </div>
    </div>
  </div>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'The AI Insurance Group <sal@theaiinsurancegroup.com>',
        to: [to],
        subject: `${riskEmoji} Your AI Coverage Gap Assessment Results — ${riskLevel || 'Moderate'} Risk Identified`,
        html: html,
        reply_to: 'sal@theaiinsurancegroup.com',
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      return res.status(response.status).json({ error: 'Email failed', details: errData });
    }

    const data = await response.json();
    return res.status(200).json({ success: true, id: data.id, portalLink });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
