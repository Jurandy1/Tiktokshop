import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, OWNER_EMAIL } from './firebase';

export function watchAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  if (!auth) throw new Error('Firebase não configurado — cheque dashboard/.env');
  if (OWNER_EMAIL && email.trim().toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    throw new Error('Acesso restrito ao dono do sistema.');
  }
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function logout() {
  if (!auth) return;
  await signOut(auth);
}
