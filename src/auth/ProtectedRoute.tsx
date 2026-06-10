import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

// ProtectedRoute gates every nested <Outlet/> behind a valid session.
// While the initial /me check is in flight we render a tiny placeholder so
// the page does not flash the login form before the cookie is checked.
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="app-loading">...</div>;
  }
  if (status === 'unauthenticated') {
    // Preserve the path the user was after so LoginPage can send them back.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}
