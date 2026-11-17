/** Secrets held in memory while the signup pages are open. */
export interface Vault { userId: string; mk: Uint8Array; akPriv: Uint8Array; akPub: Uint8Array }
