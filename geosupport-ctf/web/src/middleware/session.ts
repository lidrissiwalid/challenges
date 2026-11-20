import { Request, Response, NextFunction } from 'express';

// ── Customer session middleware ──────────────────────────────────────────────
// Validates the customer session cookie.  Admin sessions are entirely separate.

export interface CustomerSession {
  customerId: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerSession;
      isAdmin?: boolean;
    }
  }
}

// In-memory session store — keyed by token.
// A production deployment would use Redis; for this CTF a process-local map is
// sufficient and avoids exposing session data in the database.
const customerSessions = new Map<string, CustomerSession>();

export function createCustomerSession(data: CustomerSession): string {
  const crypto = require('crypto') as typeof import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  customerSessions.set(token, data);
  return token;
}

export function requireCustomer(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['session'];
  if (!token) {
    res.redirect('/login');
    return;
  }
  const session = customerSessions.get(token);
  if (!session) {
    res.clearCookie('session');
    res.redirect('/login');
    return;
  }
  req.customer = session;
  next();
}

export function optionalCustomer(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['session'];
  if (token) {
    const session = customerSessions.get(token);
    if (session) req.customer = session;
  }
  next();
}
