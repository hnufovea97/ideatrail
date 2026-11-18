import { useMemo } from "preact/hooks";
import { encode } from "uqr";

/** Builds with PUBLIC_TEST_HOOKS=1 (E2E only) expose the encoded link as data-url; real builds never do. */
const TEST_HOOKS = import.meta.env.PUBLIC_TEST_HOOKS === "1";

/** QR drawn locally as SVG rects (no network, no HTML strings). */
export function Qr({ text, label }: { text: string; label: string }) {
  const { size, cells } = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 2 });
    return { size: data.length, cells: data.flatMap((row, y) => row.flatMap((on, x) => (on ? [<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" />] : []))) };
  }, [text]);
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} data-url={TEST_HOOKS ? text : undefined} shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <g fill="#000">{cells}</g>
    </svg>
  );
}
