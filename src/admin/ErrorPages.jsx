import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Card, EmptyState, Icon, PageHeader } from './ui';
import useDocumentTitle from './hooks/useDocumentTitle';
import brandMark from '../assets/brightlight-mark.png';

// Shown inside the admin layout for a URL under /admin/ that matches no screen.
export function AdminNotFound() {
  useDocumentTitle('Page not found');
  return (
    <>
      <PageHeader title="Page not found" breadcrumb={[{ label: 'Dashboard', to: '/admin' }, { label: 'Not found' }]} />
      <Card pad={false}>
        <EmptyState
          icon="search" title="This admin page does not exist"
          hint="The link may be old or mistyped. Use the menu on the left, or go back to the dashboard."
          action={<Button variant="primary" to="/admin" icon="dashboard">Back to dashboard</Button>}
        />
      </Card>
    </>
  );
}

// Full-page notice that nothing of the admin can be shown. Two cases:
//   (default)        the signed-in account is not the store admin (AdminRoute normally redirects such an account away;
//                    this is the in-admin safety net so no admin UI renders for them)
//   reason="session" the account IS the admin address, but the database does not recognise this login (see
//                    useServerAdminCheck) -- usually a session that predates a reset. Signing out and in again fixes it.
export function AccessDenied({ reason }) {
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();
  const stale = reason === 'session';
  useDocumentTitle('Access denied');

  async function signInAgain() {
    try { await logout(); } catch { /* the redirect is what matters */ }
    navigate('/admin/login');
  }

  return (
    <div className="adm adm-fullpage">
      <div className="adm-card adm-card-body" style={{ textAlign: 'center', padding: '32px 26px' }}>
        <img src={brandMark} alt="" height="40" style={{ margin: '0 auto 14px', display: 'block' }} />
        <span className="adm-empty-ico"><Icon name="lock" size={28} /></span>
        <h1 className="adm-modal-title" style={{ marginBottom: 6 }}>{stale ? 'Please sign in again' : 'Admin access only'}</h1>
        <p className="adm-modal-text" style={{ marginBottom: 20 }}>
          {stale
            ? `You are signed in${currentUser?.email ? ` as ${currentUser.email}` : ''}, but the database does not accept this session for admin work, so orders, products and settings would show as empty. This usually means the session is out of date. Sign out and sign in again to continue.`
            : 'This account is not the store administrator, so the admin area is not available. Sign in with the admin account to continue.'}
        </p>
        <div className="adm-row" style={{ justifyContent: 'center' }}>
          {stale
            ? <Button variant="primary" icon="logout" onClick={signInAgain}>Sign out and sign in again</Button>
            : <Button variant="primary" to="/admin/login">Sign in as admin</Button>}
          <Link to="/" className="adm-btn">Back to the store</Link>
        </div>
      </div>
    </div>
  );
}
