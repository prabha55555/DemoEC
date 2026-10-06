import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { callNotifyApi } from '../../utils/orderApi';
import { Button, Card, ConfirmDialog, ErrorState, Field, PageHeader, Skeleton, StatusPill, TextInput } from '../ui';
import { isEmail } from '../lib/validate';
import { notifyAuthExpired } from '../hooks/adminWrite';

// Checks the deployed email setup (Brevo) and sends one real test message from the admin's own signed-in session.
// Both calls go through api/notify (`kind=test-email`): GET reports the configuration, POST { toEmail } sends.
// The session token is attached by callNotifyApi and never shown or stored here.
export default function EmailTestPage() {
  const [diag, setDiag] = useState(null);
  const [diagLoading, setDiagLoading] = useState(true);
  const [diagError, setDiagError] = useState(null);
  const [toEmail, setToEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);

  const check = useCallback(async () => {
    setDiagLoading(true); setDiagError(null);
    const res = await callNotifyApi('test-email', {}, { method: 'GET' });
    if (res.status === 401) notifyAuthExpired();
    if (res.ok) setDiag(res); else setDiagError({ message: res.error || 'Could not check the configuration.' });
    setDiagLoading(false);
  }, []);
  useEffect(() => { check(); }, [check]);

  function ask() {
    if (!isEmail(toEmail)) { setEmailError('Enter a valid email address.'); return; }
    setEmailError(''); setResult(null); setConfirmOpen(true);
  }

  async function send() {
    const res = await callNotifyApi('test-email', { toEmail: toEmail.trim() });
    if (res.status === 401) notifyAuthExpired();
    if (res.ok) { setResult({ ok: true, messageId: res.messageId }); toast.success('Test email sent.'); }
    else { setResult({ ok: false, error: res.error }); toast.error(res.error || 'Failed to send the test email.'); }
  }

  const rows = diag ? [
    ['Supabase project', diag.supabaseProjectRef || '—'],
    ['Admin email', diag.adminEmail || '—'],
    ['Sender address', diag.senderEmail || '—'],
    ['Brevo API key', <StatusPill kind="generic" status={diag.brevoConfigured ? 'enabled' : 'disabled'} label={diag.brevoConfigured ? 'Configured' : 'Missing'} tone={diag.brevoConfigured ? 'success' : 'danger'} />],
  ] : [];

  return (
    <>
      <PageHeader title="Email test" subtitle="Check your email setup and send yourself a real test message" />
      <div className="adm-stack" style={{ maxWidth: 760 }}>
        <Card title="Deployed configuration" actions={<Button size="sm" icon="refresh" loading={diagLoading} onClick={check}>Re-check</Button>}>
          {diagLoading && !diag ? <Skeleton height={110} radius={8} />
            : diagError ? <ErrorState error={diagError} onRetry={check} compact />
              : (
                <dl style={{ margin: 0 }}>
                  {rows.map(([k, v]) => (
                    <div key={k} className="adm-row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--adm-border)' }}>
                      <dt className="adm-muted">{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
        </Card>

        <Card title="Send a test email" subtitle="Sends one fixed test message through your email provider, so you can confirm it arrives and looks right.">
          <div className="adm-stack">
            <Field label="Recipient email" error={emailError}>
              <TextInput type="email" value={toEmail} onChange={v => { setToEmail(v); setEmailError(''); }} placeholder="you@example.com" autoComplete="email"
                onKeyDown={e => { if (e.key === 'Enter') ask(); }} />
            </Field>
            <div><Button variant="primary" icon="send" onClick={ask}>Send test email</Button></div>
            {result && (
              <div className={`adm-note ${result.ok ? 'success' : 'danger'}`} role="status">
                {result.ok ? `Sent. Provider message ID: ${result.messageId}` : `Failed: ${result.error}`}
              </div>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={send}
        title="Send one test email?" message={`A test message will be sent to ${toEmail.trim()}.`} confirmLabel="Send email" />
    </>
  );
}
