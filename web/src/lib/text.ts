// C0/C1 controls, zero-width and bidi override characters: a name must not disguise itself.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** A label from outside (link fragment, engine summary) made safe to show. Empty means "unusable". */
export const cleanLabel = (s: string, max: number): string => s.replace(UNSAFE, "").trim().slice(0, max);
