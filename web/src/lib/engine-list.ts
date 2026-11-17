export interface EngineEntry { engine_id: string; sign_pubkey: string; kem_pubkey: string; name: string; added_at: string }
export interface EngineList { v: 1; version: number; engines: EngineEntry[] }
