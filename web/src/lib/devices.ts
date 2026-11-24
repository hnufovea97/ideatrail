// Where a device lock is stored, from its authenticator id (aaguid). Unknown ids are just "기기 잠금".
const PLACES: Readonly<Record<string, string>> = {
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google 비밀번호 관리자",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud 키체인",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud 키체인",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome(Mac)",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};
export const UNKNOWN_PLACE = "기기 잠금";

export const storagePlace = (aaguid: string | null | undefined): string => (aaguid ? PLACES[aaguid.toLowerCase()] : undefined) ?? UNKNOWN_PLACE;

/** The server refuses the last device lock; the screen does not even offer it. */
export const canRemoveDevice = (count: number): boolean => count > 1;
