export type CryptoSector = 'L1' | 'L2' | 'DeFi' | 'AI' | 'Meme' | 'Gaming' | 'RWA' | 'Infrastructure' | 'Exchange' | 'Other';

const SECTOR_MAP: Record<string, CryptoSector> = {
  // L1s
  BTC: 'L1', ETH: 'L1', SOL: 'L1', ADA: 'L1', AVAX: 'L1', DOT: 'L1', ATOM: 'L1',
  NEAR: 'L1', SUI: 'L1', APT: 'L1', SEI: 'L1', TON: 'L1', XRP: 'L1', TRX: 'L1',
  ALGO: 'L1', HBAR: 'L1', ICP: 'L1', FTM: 'L1', EGLD: 'L1', KAVA: 'L1', INJ: 'L1',
  TIA: 'L1', STX: 'L1', KAS: 'L1', RUNE: 'L1',
  
  // L2s
  MATIC: 'L2', OP: 'L2', ARB: 'L2', IMX: 'L2', MANTA: 'L2', METIS: 'L2',
  STRK: 'L2', ZK: 'L2', BLAST: 'L2', SCROLL: 'L2', BASE: 'L2',
  
  // DeFi
  UNI: 'DeFi', AAVE: 'DeFi', LINK: 'DeFi', MKR: 'DeFi', SNX: 'DeFi', CRV: 'DeFi',
  COMP: 'DeFi', SUSHI: 'DeFi', YFI: 'DeFi', BAL: 'DeFi', DYDX: 'DeFi', GMX: 'DeFi',
  PENDLE: 'DeFi', JUP: 'DeFi', RAY: 'DeFi', ORCA: 'DeFi', LDO: 'DeFi', RPL: 'DeFi',
  CAKE: 'DeFi', '1INCH': 'DeFi', JTO: 'DeFi', PYTH: 'DeFi', W: 'DeFi',
  
  // AI
  FET: 'AI', AGIX: 'AI', OCEAN: 'AI', RNDR: 'AI', AKT: 'AI', TAO: 'AI',
  WLD: 'AI', ARKM: 'AI', PRIME: 'AI', AIOZ: 'AI', JASMY: 'AI', RENDER: 'AI',
  
  // Meme
  DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', FLOKI: 'Meme', BONK: 'Meme', WIF: 'Meme',
  MEME: 'Meme', MYRO: 'Meme', BOME: 'Meme', TURBO: 'Meme', NEIRO: 'Meme',
  POPCAT: 'Meme', MOG: 'Meme', BRETT: 'Meme',
  
  // Gaming
  AXS: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', GALA: 'Gaming', ENJ: 'Gaming',
  ILV: 'Gaming', BEAM: 'Gaming', PIXEL: 'Gaming', RONIN: 'Gaming', RON: 'Gaming',
  PORTAL: 'Gaming', XAI: 'Gaming', SUPER: 'Gaming',
  
  // RWA
  ONDO: 'RWA', PROPS: 'RWA', RIO: 'RWA', POLYX: 'RWA', RSR: 'RWA',
  
  // Infrastructure
  FIL: 'Infrastructure', AR: 'Infrastructure', GRT: 'Infrastructure', THETA: 'Infrastructure',
  ANKR: 'Infrastructure', LPT: 'Infrastructure', GLM: 'Infrastructure', STORJ: 'Infrastructure',
  
  // Exchange tokens
  BNB: 'Exchange', OKB: 'Exchange', CRO: 'Exchange', GT: 'Exchange', MX: 'Exchange',
};

export function getSector(symbol: string): CryptoSector {
  const clean = symbol.replace('USDT', '').replace('USDC', '').replace('USD', '');
  return SECTOR_MAP[clean] || 'Other';
}

export function getSectorColor(sector: CryptoSector): string {
  const colors: Record<CryptoSector, string> = {
    L1: 'hsl(142 72% 45%)',
    L2: 'hsl(168 72% 45%)',
    DeFi: 'hsl(217 90% 60%)',
    AI: 'hsl(280 72% 55%)',
    Meme: 'hsl(45 90% 55%)',
    Gaming: 'hsl(320 72% 55%)',
    RWA: 'hsl(25 80% 55%)',
    Infrastructure: 'hsl(190 60% 50%)',
    Exchange: 'hsl(0 0% 60%)',
    Other: 'hsl(0 0% 40%)',
  };
  return colors[sector];
}

export function getSectorEmoji(sector: CryptoSector): string {
  const emojis: Record<CryptoSector, string> = {
    L1: '⛓️', L2: '🔗', DeFi: '🏦', AI: '🤖', Meme: '🐸',
    Gaming: '🎮', RWA: '🏠', Infrastructure: '🔧', Exchange: '💱', Other: '📊',
  };
  return emojis[sector];
}

export const ALL_SECTORS: CryptoSector[] = ['L1', 'L2', 'DeFi', 'AI', 'Meme', 'Gaming', 'RWA', 'Infrastructure', 'Exchange', 'Other'];
