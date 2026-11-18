import { useCallback, useEffect, useState } from "preact/hooks";
import { COPY, errorMessage } from "../../lib/copy";
import { offerDevice, pollOffer, type DeviceOffer, type OfferProgress } from "../../lib/device-add";
import type { StepProps } from "../../lib/signup/context";
import { stepNumber } from "../../lib/signup/machine";
import { POLL_MS } from "../../lib/timing";
import { CopyButton } from "../ui/CopyButton";
import { Qr } from "../ui/Qr";
import { Screen } from "../ui/Screen";
import { usePolling } from "../ui/usePolling";

export function PhoneStep({ api, ctx, state, dispatch }: StepProps) {
  const [offer, setOffer] = useState<DeviceOffer | null>(null);
  const [progress, setProgress] = useState<OfferProgress>("waiting");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const renew = useCallback((why: string | null) => {
    setNote(why);
    setProgress("waiting");
    setOffer(null);
    offerDevice(api, location.origin).then(setOffer, (e) => setError(errorMessage(e)));
  }, [api]);
  useEffect(() => renew(null), [renew]);

  usePolling(!!offer && !!ctx.vault, POLL_MS, async () => {
    if (!offer || !ctx.vault) return true;
    const expired = Date.now() >= offer.expiresAt;
    if (expired && progress === "waiting") {
      renew(COPY.errors.qr_expired); // nobody joined in 2 minutes (spec §10, UX 오류표 "QR 만료")
      return true;
    }
    try {
      const p = await pollOffer(api, offer, ctx.vault); // once sent, this only reads (no second upload)
      setError(null);
      if (p === "done") dispatch({ type: "phone_done" });
      else if (p === "intruder") renew(COPY.errors.qr_intruder);
      else if (expired) renew(COPY.errors.qr_expired); // key sent but the phone did not finish in time
      else setProgress(p);
      return p === "done" || p === "intruder" || expired;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, [offer, progress]);

  return (
    <Screen step={stepNumber(state.step)} title={COPY.phone.title} why={COPY.phone.why} done={state.done} error={error}>
      <p>{COPY.phone.scan}</p>
      {offer ? (
        <>
          <Qr text={offer.url} label={COPY.phone.qrLabel} />
          <details class="no-scan">
            <summary>{COPY.phone.noScan}</summary>
            <p class="small">{COPY.phone.linkWarn}</p>
            <CopyButton text={offer.url} label={COPY.phone.copyLink} />
          </details>
        </>
      ) : null}
      <p class="small" aria-live="polite">{progress === "sent" ? COPY.phone.sent : note ?? ""}</p>
      <button type="button" class="link" onClick={() => dispatch({ type: "phone_skip" })}>{COPY.phone.skip}</button>
    </Screen>
  );
}
