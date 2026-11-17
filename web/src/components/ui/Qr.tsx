import { encode } from "uqr";

/** QR drawn locally as SVG rects (no network, no HTML strings). data-url = the encoded link, same as the picture. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { data } = encode(text, { ecc: "M", border: 2 });
  const size = data.length;
  const cells = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" />] : [])));
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} data-url={text} shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <g fill="#000">{cells}</g>
    </svg>
  );
}
