import type { Api, PairingInfo } from "../api";
import type { EngineEntry } from "../engine-list";
import type { PairingLink } from "../fragment";
import type { Vault } from "./account";
import type { SignupEvent, SignupState } from "./machine";

/** Everything the signup screens hold in memory (never in storage). */
export interface SignupContext {
  link: PairingLink;
  href: string; // original link, for [링크 복사] when this browser cannot do PRF
  info: PairingInfo;
  signPub: Uint8Array;
  kemPub: Uint8Array;
  vault: Vault | null;
  engine: EngineEntry | null;
}

export interface StepProps {
  api: Api;
  ctx: SignupContext;
  setCtx: (next: SignupContext) => void;
  state: SignupState;
  dispatch: (e: SignupEvent) => void;
}
