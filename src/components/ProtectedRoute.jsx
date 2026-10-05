import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BufferingLogo from './BufferingLogo';

export function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();

  // Wait for Supabase to resolve session -- a spinner, not a blank page. This
  // window can run several seconds on a slow connection (or the first request
  // after being idle for a while), and rendering nothing at all made that
  // delay look identical to the page being broken, with no sign anything was
  // happening.
  if (loading) return <BufferingLogo fullPage size={72} />;

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

export function AdminRoute({ children }) {
  const { currentUser, isAdmin, loading } = useAuth();
  const location = useLocation();

  // Wait for Supabase to resolve session -- see ProtectedRoute above.
  if (loading) return <BufferingLogo fullPage size={72} />;

  if (!currentUser) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}