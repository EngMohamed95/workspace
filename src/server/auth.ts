import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { SqlDatabase, SqlExecutor } from './db.ts';
import type { AuthUser, UserRole } from '../shared/types.ts';

const SCRYPT_KEYLEN = 64;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authToken?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function constantTimeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function mapUserRow(row: {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: number;
  created_at: string;
}): AuthUser {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
  };
}

export async function createAuthToken(
  db: SqlExecutor,
  userId: number
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();

  await db.execute(
    'INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [tokenHash, userId, expiresAt, now.toISOString()]
  );

  return rawToken;
}

export async function revokeAuthToken(
  db: SqlExecutor,
  rawToken: string
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db.execute('DELETE FROM auth_tokens WHERE token_hash = ?', [tokenHash]);
}

export async function getUserByToken(
  db: SqlExecutor,
  rawToken: string
): Promise<AuthUser | null> {
  const tokenHash = hashToken(rawToken);
  const row = await db.queryOne<{
    id: number;
    username: string;
    display_name: string;
    role: UserRole;
    is_active: number;
    created_at: string;
    expires_at: string;
  }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at, t.expires_at
     FROM auth_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
    [tokenHash]
  );

  if (!row) return null;
  if (Number(row.is_active) !== 1) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.execute('DELETE FROM auth_tokens WHERE token_hash = ?', [
      tokenHash,
    ]);
    return null;
  }

  return mapUserRow(row);
}

export function createAuthMiddleware(db: SqlDatabase) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'يرجى تسجيل الدخول أولًا للمتابعة.' });
        return;
      }

      const token = authHeader.slice('Bearer '.length).trim();
      if (!token) {
        res.status(401).json({ error: 'رمز الجلسة غير صالح.' });
        return;
      }

      const user = await getUserByToken(db, token);
      if (!user) {
        res.status(401).json({
          error: 'انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى.',
        });
        return;
      }

      req.authUser = user;
      req.authToken = token;
      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      res.status(500).json({ error: 'تعذر التحقق من جلسة المستخدم.' });
    }
  };
}

export function requireRole(actor: AuthUser, allowed: UserRole[]): void {
  if (!allowed.includes(actor.role)) {
    const err = new Error('هذه العملية متاحة للمدير فقط.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}

export function getConfiguredAdminPasscode(): string | null {
  const val = process.env.ADMIN_PASSCODE?.trim();
  return val && val.length > 0 ? val : null;
}
