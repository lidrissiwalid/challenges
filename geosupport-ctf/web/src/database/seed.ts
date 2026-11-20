import { Customer } from './models';

export async function seedDatabase(): Promise<void> {
  const email    = process.env.SEED_USER_EMAIL    ?? 'alice@geosupport.local';
  const password = process.env.SEED_USER_PASSWORD ?? 'changeme';

  const existing = await Customer.findOne({ email });
  if (existing) {
    console.log('[seed] Customer already exists, skipping');
    return;
  }

  // Password is stored in plaintext intentionally — this is a CTF challenge
  // where the goal is NoSQL injection, not password cracking.
  await Customer.create({ email, password, name: 'Alice' });
  console.log(`[seed] Seeded customer: ${email}`);
}
