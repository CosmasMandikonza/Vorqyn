import { CutoutCard } from './ui/cutout-card';
import { Noise } from './noise';

type Point = readonly [number, number, number];
const point = ([x, y, z]: Point) => [520 + (x - y) * 0.86, 310 + (x + y) * 0.43 - z] as const;
const points = (values: readonly Point[]) => values.map((p) => point(p).join(',')).join(' ');
function Block({ x, y, width, depth, height, top = '#d8d7c9', side = '#a7b3a8', front = '#bac4b8', z = 0 }: { x: number; y: number; width: number; depth: number; height: number; top?: string; side?: string; front?: string; z?: number }) {
  const a: Point = [x, y, z + height], b: Point = [x + width, y, z + height], c: Point = [x + width, y + depth, z + height], d: Point = [x, y + depth, z + height];
  return <g stroke="#345651" strokeWidth="0.8" strokeLinejoin="round"><polygon points={points([d, c, [x + width, y + depth, z], [x, y + depth, z]])} fill={front} /><polygon points={points([b, c, [x + width, y + depth, z], [x + width, y, z]])} fill={side} /><polygon points={points([a, b, c, d])} fill={top} /></g>;
}
function Line({ from, to, ...props }: { from: Point; to: Point } & Omit<React.SVGProps<SVGLineElement>, "from" | "to">) {
  const [x1, y1] = point(from), [x2, y2] = point(to);
  return <line x1={x1} y1={y1} x2={x2} y2={y2} {...props} />;
}
function Crane({ x, y }: { x: number; y: number }) {
  return <g fill="none" stroke="#955239" strokeWidth="5" strokeLinejoin="round">
    <Line from={[x, y, 16]} to={[x, y, 155]} /><Line from={[x + 65, y, 16]} to={[x + 65, y, 155]} />
    <Line from={[x - 35, y, 155]} to={[x + 115, y, 155]} /><Line from={[x - 35, y, 155]} to={[x + 65, y, 220]} /><Line from={[x + 65, y, 220]} to={[x + 115, y, 155]} />
    <Line from={[x + 65, y, 220]} to={[x + 65, y, 155]} /><Line from={[x, y, 60]} to={[x + 65, y, 130]} strokeWidth="2" />
    <Line from={[x, y, 130]} to={[x + 65, y, 60]} strokeWidth="2" /><Line from={[x + 105, y, 155]} to={[x + 105, y, 65]} strokeWidth="1.5" />
    <Line from={[x - 10, y, 16]} to={[x + 10, y, 16]} strokeWidth="8" /><Line from={[x + 55, y, 16]} to={[x + 75, y, 16]} strokeWidth="8" />
  </g>;
}

/** Original editorial SVG. Coordinates describe artwork, never machine state. */
export function PortConcept({ compact = false }: { compact?: boolean }) {
  return <figure className={`port-figure ${compact ? 'port-compact' : ''}`}>
    <CutoutCard label="Concept preview · Original illustration" className="port-frame">
      <div className="art-kicker"><span>FIELD STUDY / 001</span><span>STORM RECOVERY · PORT</span></div>
      <Noise />
      <svg viewBox="0 0 1040 750" role="img" aria-labelledby="port-title port-description" className="port-art">
        <title id="port-title">Air, land and underwater operations in one port</title>
        <desc id="port-description">An original axonometric cutaway: a drone above two copper cranes, a rover on the connected dock and an underwater inspection vehicle below the same waterline. This is concept artwork, with no live machine positions.</desc>
        <defs>
          <pattern id="draft-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#91a69c" strokeWidth=".5" opacity=".32" /></pattern>
          <pattern id="sea-lines" width="28" height="16" patternUnits="userSpaceOnUse"><path d="M0 8Q7 4 14 8T28 8" fill="none" stroke="#b6d4c6" strokeWidth=".65" opacity=".5" /></pattern>
        </defs>
        <rect width="1040" height="750" fill="url(#draft-grid)" />
        <g transform="translate(120 44) scale(.84)">
        <ellipse cx="522" cy="618" rx="350" ry="42" fill="#7f968a" opacity=".14" />
        <polygon points={points([[-380,-220,0],[380,-220,0],[380,360,0],[-380,360,0]])} fill="#a6bfb1" stroke="#6a8b7e" />
        <polygon points={points([[-380,360,0],[380,360,0],[380,360,-135],[-380,360,-135]])} fill="#385f5b" />
        <polygon points={points([[380,-220,0],[380,360,0],[380,360,-135],[380,-220,-135]])} fill="#244c4b" />
        <polygon points={points([[-380,-220,0],[380,-220,0],[380,360,0],[-380,360,0]])} fill="url(#sea-lines)" />
        <Block x={-380} y={-220} width={760} depth={185} height={18} />
        <Block x={-280} y={-35} width={115} depth={335} height={18} />
        <Block x={120} y={-35} width={115} depth={335} height={18} />
        {[-245,-195,155,205].map((x) => <g key={x} stroke="#345651" strokeWidth="8"><Line from={[x,240,0]} to={[x,240,-115]} /><Line from={[x,85,0]} to={[x,85,-115]} /></g>)}
        <g stroke="#f6f1de" strokeWidth="2.5" strokeDasharray="12 10"><Line from={[-345,-75,19]} to={[340,-75,19]} /><Line from={[-220,-25,19]} to={[-220,280,19]} /><Line from={[175,-25,19]} to={[175,280,19]} /></g>
        <Block x={-310} y={-200} width={170} depth={83} height={62} top="#eae8db" front="#c7ccbe" />
        {[-285,-250,-215,-180].map(x => <Line key={x} from={[x,-200,81]} to={[x,-117,81]} stroke="#a1ada1" strokeWidth="1.5" />)}
        <Block x={-90} y={-190} width={82} depth={40} height={28} top="#a4674e" front="#a2654e" side="#7f4d3c" />
        <Block x={-90} y={-140} width={82} depth={40} height={28} top="#6c8980" front="#789088" side="#4e6b63" />
        <Block x={10} y={-190} width={82} depth={40} height={28} top="#dfd9c5" />
        <Block x={10} y={-140} width={82} depth={40} height={28} top="#a4674e" front="#a2654e" side="#7f4d3c" />
        <Crane x={-275} y={60} /><Crane x={125} y={50} />
        <g fill="none" stroke="#f3ecda" strokeWidth="1.5" strokeDasharray="5 5">
          <path d="M429 236C485 171 691 163 749 219S686 322 595 308" />
        </g>
        <g transform="translate(584 155)" stroke="#264a46" strokeWidth="3" fill="#e9e6d6">
          <path d="M-24-14 24 14M-24 14 24-14" /><rect x="-10" y="-7" width="20" height="14" rx="4" />
          {[-1,1].flatMap(x=>[-1,1].map(y=><ellipse key={`${x}${y}`} cx={x*27} cy={y*16} rx="16" ry="5" strokeWidth="1.3" />))}
          <path d="m-4 9-4 9m12-9 4 9" fill="none" />
        </g>
        <g transform="translate(449 367)">
          <ellipse cy="10" rx="27" ry="9" fill="#527367" opacity=".22" />
          <path d="m-22-5 26-12 22 12-26 13Z" fill="#f0ecdd" stroke="#345651" />
          <path d="M-22-5v13L0 20V8m0 12 26-13V-5" fill="#aebbae" stroke="#345651" />
          <g fill="#244a46"><ellipse cx="-15" cy="12" rx="5" ry="8" /><ellipse cx="14" cy="12" rx="5" ry="8" /></g>
          <path d="M1-11v-17" stroke="#345651" strokeWidth="2" /><circle cy="-28" cx="1" r="4" fill="#b65b41" />
        </g>
        <g fill="none" stroke="#aacbbe" opacity=".5"><path d="m674 621 76-26 83 31-72 27Z" /><path d="m652 639 108 40 110-44" strokeDasharray="4 6" /></g>
        <g transform="translate(720 610)" stroke="#cfe1ce" strokeWidth="1.5">
          <path d="m-22-5 27-10 24 12-27 10Z" fill="#d49a76" /><path d="M-22-5v18L2 25V7m0 18 27-12V-3" fill="#bb8062" />
          <path d="M-30-5v22m65-26v22M-27 1 32-4" fill="none" /><circle cx="7" cy="14" r="4" fill="#254c49" />
        </g>
        <path d="M721 610C694 564 650 540 590 490" fill="none" stroke="#d3c9a7" strokeWidth="1.5" />
        <g fill="none" stroke="#557468" strokeWidth="1">
          <path d="M584 132V85H758" /><path d="M426 366H195V314H119" />
        </g>
        <g fill="none" stroke="#b8d0bd" strokeWidth="1"><path d="M749 615H830V640H880" /></g>
        <g fontFamily="'IBM Plex Mono',monospace" fontSize="15" fill="#244b45">
          <text x="652" y="72">01 / AIR</text><text x="98" y="299">02 / LAND</text>
        </g>
        <text x="695" y="662" fontFamily="'IBM Plex Mono',monospace" fontSize="15" fill="#f3eedb">03 / UNDERWATER</text>
        <g fill="none" stroke="#6b877b" strokeWidth="1"><path d="M72 649v25h80M940 115V90h-80" /><path d="m880 666 15-27 15 27m-15-27v44" fill="none" /></g>
        <text x="94" y="706" fontFamily="'IBM Plex Mono',monospace" fontSize="13" fill="#36594e">A SHARED ENVIRONMENT. DISTINCT CAPABILITIES.</text>
        </g>
      </svg>
    </CutoutCard>
    <figcaption><span>Air survey. Ground access. Submerged obstruction mapping.</span><span>Concept art — not a running simulator.</span></figcaption>
  </figure>;
}
