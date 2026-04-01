// This file is kept for backwards compatibility.
// All indicator logic has been moved to src/lib/indicators/ directory.
export { analyzeTrend } from './indicators/analyze';
export type { IndicatorDetail, SupportResistance, ConfirmedTrend } from './indicators/analyze';
export { calculateEMA } from './indicators/moving-averages';
export { calculateADX, calculateATR } from './indicators/trend';
export { calculateRSI, calculateMACD } from './indicators/momentum';
export { calculateVolumeRatio } from './indicators/volume';
