import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminLayout from '../admin/AdminLayout';
import AdminRoutes from '../admin/routes';
import { AccessDenied } from '../admin/ErrorPages';
import useServerAdminCheck from '../admin/useServerAdminCheck';
import BufferingLogo from '../components/BufferingLogo';
import '../styles/admin.css';

// The admin back-office, mounted by App.jsx at /admin/* (behind AdminRoute). Deliberately thin: the sidebar / top
// bar live in src/admin/AdminLayout.jsx, every screen in src/admin/** and the URL -> screen map in
// src/admin/routes.jsx. Each screen is its own URL, so refresh and deep links land on the same page.
export default function Admin() {
  const { currentUser, isAdmin } = useAuth();
  // Ask the database too: row-level security hides everything from a login it does not recognise as the admin
  // WITHOUT raising an error, which would otherwise look like an empty store (see useServerAdminCheck).
  const server = useServerAdminCheck(currentUser && isAdmin ? currentUser.id : null);

  // AdminRoute already redirects these cases; repeating the checks means no admin UI can ever render for a
  // signed-out visitor or a customer account even if this component is mounted another way. The server (RLS +
  // requireAdmin) is the real gate -- this only decides what to show.
  if (!currentUser) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) return <AccessDenied />;
  if (server === 'checking') return <BufferingLogo fullPage size={72} />;
  if (server === 'denied') return <AccessDenied reason="session" />;

  return (
    <AdminLayout>
      <AdminRoutes />
    </AdminLayout>
  );
}
