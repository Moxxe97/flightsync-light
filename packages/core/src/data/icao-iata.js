// ICAO → IATA for the AC network. Used as a FALLBACK: the OFP header prints
// both forms ("CYUL/YUL - LIRN/NAP") and the parser prefers the printed IATA,
// so this table only decides (a) legacy stored flights being normalized and
// (b) OFPs whose header route line couldn't be read.
// Every IATA value here must have coordinates in AIRPORTS (parity-tested).
export const ICAO_TO_IATA = {
  // Canada — majors
  CYUL:'YUL', CYVR:'YVR', CYYZ:'YYZ', CYOW:'YOW', CYYC:'YYC',
  CYEG:'YEG', CYHZ:'YHZ', CYWG:'YWG', CYQB:'YQB', CYXE:'YXE',
  // Canada — AC regional network (missing pre-2026-07; a stored raw ICAO here
  // broke CANADIAN_IATA classification, which is tax-relevant)
  CYYT:'YYT', CYQM:'YQM', CYFC:'YFC', CYYG:'YYG', CYDF:'YDF',
  CYQR:'YQR', CYXU:'YXU', CYQT:'YQT', CYYJ:'YYJ', CYLW:'YLW',
  CYXY:'YXY', CYZF:'YZF',
  VIDP:'DEL', VABB:'BOM', VOMM:'MAA', VOBL:'BLR', VOCI:'COK',
  LFPG:'CDG', LFPO:'ORY', LFBO:'TLS', LFLL:'LYS', LFMN:'NCE',
  EGLL:'LHR', EGKK:'LGW', EGSS:'STN', EGCC:'MAN', EGPH:'EDI',
  EIDW:'DUB',
  EDDF:'FRA', EDDM:'MUC', EDDB:'BER', LSZH:'ZRH', LSGG:'GVA', LOWW:'VIE',
  EHAM:'AMS', EBBR:'BRU', ENGM:'OSL', EKCH:'CPH', ESSA:'ARN',
  LEMD:'MAD', LEBL:'BCN', LPPT:'LIS', LIRF:'FCO', LIMC:'MXP',
  LIPZ:'VCE', LIRN:'NAP', LGAV:'ATH',
  EPWA:'WAW', LHBP:'BUD', LKPR:'PRG',
  OMDB:'DXB', OERK:'RUH', OTHH:'DOH', HECA:'CAI', FAOR:'JNB',
  GMMN:'CMN', LLBG:'TLV',
  VHHH:'HKG', RCTP:'TPE', RJAA:'NRT', RJTT:'HND', RJBB:'KIX',
  RKSI:'ICN', WSSS:'SIN', VTBS:'BKK', WMKK:'KUL',
  ZGGG:'CAN', ZBAA:'PEK', ZSPD:'PVG', YSSY:'SYD', YMML:'MEL',
  MMUN:'CUN', MMMX:'MEX', MROC:'SJO', MUVR:'VRA', MDSD:'SDQ',
  MDPC:'PUJ', MKJS:'MBJ', TBPB:'BGI', MUHA:'HAV', MMPR:'PVR',
  MMSD:'SJD', TNCA:'AUA', SBGR:'GRU', SCEL:'SCL',
  KORD:'ORD', KJFK:'JFK', KLAX:'LAX', KSFO:'SFO', KATL:'ATL',
  KDFW:'DFW', KMIA:'MIA', KBOS:'BOS', KEWR:'EWR', KIAD:'IAD',
  KDEN:'DEN', KSEA:'SEA', KLAS:'LAS', KMCO:'MCO', KFLL:'FLL',
  KTPA:'TPA', KPHX:'PHX', KSAN:'SAN',
};

// Normalize an airport code to IATA: 4-letter ICAO codes in the table map to
// their IATA; anything else (already-IATA, or an ICAO we don't know) passes
// through unchanged so callers never lose information.
export function toIata(code) {
  if (!code) return '';
  const u = String(code).toUpperCase().trim();
  return ICAO_TO_IATA[u] ?? u;
}
