import { useContext } from 'react';
import { AuthContext, type AuthState } from './authContext';

// useAuth must be called inside an <AuthProvider>. We throw on null rather
// than returning a default so misuse fails loudly during development.
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
