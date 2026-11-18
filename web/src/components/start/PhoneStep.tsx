import { useCallback, useEffect, useState } from "preact/hooks";
import { COPY, didLine, errorMessage } from "../../lib/copy";
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
  const [offerFailed, setOfferFailed] = useState(false);

  // The note is cleared first and set again once the new QR is up, so every renewal is announced.
  const renew = useCallback((why: string | null) => {
    setNote(null);
    setProgress("waiting");
    setOffer(null);
    setOfferFailed(false);
    offerDevice(api, location.origin).then((o) => {
      setOffer(o);
      setNote(why);
      setError(null);
    }, (e) => {
      setError(errorMessage(e));
      setOfferFailed(true);
    });
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
  }, [offer, progress], (e) => setError(errorMessage(e)));

  return (
    <Screen step={stepNumber(state.step)} did={didLine(state)} title={COPY.phone.title} why={COPY.phone.why} done={state.done} error={error}>
      <p class="ahead">{COPY.phone.ahead}</p>
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
      {offerFailed ? <button type="button" class="primary" onClick={() => renew(null)}>{COPY.actions.retry}</button> : null}
      <p class="small" role="status">{progress === "sent" ? COPY.phone.sent : note ?? ""}</p>
      <button type="button" class="link" onClick={() => dispatch({ type: "phone_skip" })}>{COPY.phone.skip}</button>
    </Screen>
  );
}
