// Quick validation of the parser against a real AC OFP
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
pdfjs.GlobalWorkerOptions.workerSrc = resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node test-pdf.mjs <file.pdf>'); process.exit(1); }

const data = new Uint8Array(readFileSync(resolve(filePath)));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

let text = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  text += content.items.map(i => i.str).join(' ') + '\n';
}

const T = text.toUpperCase();
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
const ICAO = { CYUL:'YUL',CYVR:'YVR',CYYZ:'YYZ',VIDP:'DEL',LFBO:'TLS',MMUN:'CUN',EGLL:'LHR',EHAM:'AMS' };
const resolve2 = c => ICAO[c] ?? c;

function hhmm(s) {
  const m = s?.trim().match(/^(\d{1,2}):?(\d{2})$/);
  return m ? parseInt(m[1]) + parseInt(m[2])/60 : 0;
}

// 1. Flight numbers
const fns = [...new Set([...T.matchAll(/\bAC[A]?\s*0*(\d{1,4})\b/g)].map(m => 'AC'+m[1].padStart(4,'0')))];

// 2. Dates — search only first 2000 chars (OFP header) to avoid stale dates in NOTAMs/charts
const HEADER = T.slice(0, 2000);
const dateRe = /(\d{1,2})[\s.]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s.]*(\d{4})/g;
const dates = [...new Set([...HEADER.matchAll(dateRe)].map(m => {
  const [,d,mo,y] = m; return `${y}-${String(MONTHS[mo]).padStart(2,'0')}-${d.padStart(2,'0')}`;
}))].filter(d => d >= '2020-01-01' && d <= '2035-12-31').sort();

// 3. Route
const hdr = T.match(/([A-Z]{4})\/[A-Z]{3}\s*-\s*([A-Z]{4})\/[A-Z]{3}/);
const dep = hdr ? resolve2(hdr[1]) : '?';
const arr = hdr ? resolve2(hdr[2]) : '?';

// 4. Block time
const bt = T.match(/BLOCK\s+TIME\s+(\d{4})\s+(\d{4})/);
const blockTime = bt ? hhmm(bt[2]) : 0;

// 5. EET
const eet = T.match(/\bEET\s+(\d{4})\b/);
const eetTime = eet ? hhmm(eet[1]) : 0;

// 6. GC distance
const gc = T.match(/G\/C\s+(\d{4,5})\b/);
const gcDist = gc ? parseInt(gc[1]) : 0;

const totalTime = blockTime || eetTime;
const canDist = Math.min(880, gcDist);
const canTime = gcDist > 0 ? (totalTime * canDist / gcDist).toFixed(2) : '?';
const canPct = gcDist > 0 ? ((canDist/gcDist)*100).toFixed(1) : '?';

console.log('\n=== RÉSULTATS PARSER ===');
console.log('Numéros de vol :', fns.join(', '));
console.log('Date            :', dates[0] ?? '— non trouvée');
console.log('Route           :', dep, '→', arr);
console.log('Block time      :', bt ? `${bt[2]} (${blockTime.toFixed(2)}h)` : '— non trouvé');
console.log('EET             :', eet ? `${eet[1]} (${eetTime.toFixed(2)}h)` : '— non trouvé');
console.log('GC distance     :', gcDist ? `${gcDist} nm` : '— non trouvée');
console.log('─────────────────────────────');
console.log('→ Temps total   :', totalTime.toFixed(2), 'h');
console.log('→ Temps canadien:', canTime, 'h');
console.log('→ Dist canadienne:', canDist, 'nm');
console.log('→ % canadien    :', canPct, '%');
console.log('');
const conf = (dates[0]?25:0) + (dep!=='?'&&arr!=='?'?35:0) + (totalTime?25:0) + (gcDist?15:0);
console.log('Fiabilité       :', conf, '/ 100');
