// ed25519 mandate signing with the app's own demo keypair. This is NOT AP2/FIDO conformance.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, type KeyObject } from 'node:crypto';
import type { Db } from './db.ts';
import { nowIso } from './util.ts';

export const DEMO_KEY_NOTE = 'Mandate Ledger demo key';

interface Row { key_id: string; public_key: string; private_key: string }

export class Signer {
  readonly keyId: string;
  private priv: KeyObject;
  private db: Db;

  /** Uses MANDATE_SIGNING_KEY (base64 PKCS8 DER) when given, else the persisted key, else generates one. */
  constructor(db: Db, envKeyB64: string) {
    this.db = db;
    if (envKeyB64) {
      this.priv = createPrivateKey({ key: Buffer.from(envKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
      this.keyId = 'key_env_1';
      this.persist(this.keyId, this.priv);
      return;
    }
    const existing = db.prepare("SELECT * FROM signing_keys WHERE key_id = 'key_demo_1'").get() as Row | undefined;
    if (existing) {
      this.priv = createPrivateKey({ key: Buffer.from(existing.private_key, 'base64'), format: 'der', type: 'pkcs8' });
      this.keyId = existing.key_id;
      return;
    }
    const { privateKey } = generateKeyPairSync('ed25519');
    this.priv = privateKey;
    this.keyId = 'key_demo_1';
    this.persist(this.keyId, privateKey);
  }

  private persist(keyId: string, priv: KeyObject): void {
    const pub = createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
    const priv64 = priv.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    this.db.prepare('INSERT OR IGNORE INTO signing_keys (key_id, public_key, private_key, created_at) VALUES (?, ?, ?, ?)')
      .run(keyId, pub, priv64, nowIso());
  }

  sign(payload: string): string {
    return nodeSign(null, Buffer.from(payload, 'utf8'), this.priv).toString('base64');
  }

  /** Verifies against the stored PUBLIC key for keyId (never trusts anything in the signature row). */
  verify(payload: string, sigB64: string, keyId: string): boolean {
    const row = this.db.prepare('SELECT public_key FROM signing_keys WHERE key_id = ?').get(keyId) as { public_key: string } | undefined;
    if (!row) return false;
    try {
      const pub = createPublicKey({ key: Buffer.from(row.public_key, 'base64'), format: 'der', type: 'spki' });
      return nodeVerify(null, Buffer.from(payload, 'utf8'), pub, Buffer.from(sigB64, 'base64'));
    } catch {
      return false;
    }
  }
}
