import { useState } from 'react';
import { NavLink } from '@/components/NavLink';
import { useLocation, Outlet } from 'react-router-dom';
import {
  BarChart3, ChartCandlestick, LayoutGrid, Network, Layers, Zap, Calculator,
  Activity, ArrowUpDown, Grid3X3, Box, Flame, DollarSign, GitBranch, PieChart,
  MoreHorizontal, X, TrendingUp, Compass, Wrench, RotateCcw, Rocket, Crosshair,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const NAV_GROUPS = [
  {
    label: 'Scanners',
    icon: TrendingUp,
    items: [
      { to: '/', label: 'Trend Scanner', icon: BarChart3 },
      { to: '/reversals', label: 'Reversals', icon: RotateCcw },
      { to: '/indicator-scanner', label: 'Indicators', icon: Activity },
      { to: '/momentum', label: 'Momentum', icon: Rocket },
      { to: '/breakouts', label: 'Breakouts', icon: Crosshair },
      { to: '/confluence', label: 'Confluence', icon: Zap },
      { to: '/range-scanner', label: 'Range', icon: Layers },
    ],
  },
  {
    label: 'Patterns',
    icon: ChartCandlestick,
    items: [
      { to: '/candlestick-patterns', label: 'Candlestick', icon: ChartCandlestick },
      { to: '/chart-patterns', label: 'Chart Patterns', icon: LayoutGrid },
      { to: '/market-structure', label: 'SMC', icon: Network },
      { to: '/supply-demand', label: 'Supply & Demand', icon: Box },
    ],
  },
  {
    label: 'Market',
    icon: Compass,
    items: [
      { to: '/market-overview', label: 'Overview', icon: Activity },
      { to: '/heatmap', label: 'Heatmap', icon: Grid3X3 },
      { to: '/sectors', label: 'Sectors', icon: PieChart },
      { to: '/funding', label: 'Funding Rates', icon: DollarSign },
      { to: '/correlation', label: 'Correlation', icon: GitBranch },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { to: '/mtf', label: 'Multi-Timeframe', icon: ArrowUpDown },
      { to: '/volatility', label: 'Volatility', icon: Flame },
      { to: '/trade-planner', label: 'Trade Planner', icon: Calculator },
    ],
  },
];

// Flat list of all items for lookups
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// Primary mobile tabs (most used)
const MOBILE_TABS = [
  { to: '/', label: 'Trends', icon: BarChart3 },
  { to: '/confluence', label: 'Confluence', icon: Zap },
  { to: '/market-overview', label: 'Market', icon: Activity },
  { to: '/trade-planner', label: 'Trade', icon: Calculator },
];

const MOBILE_TAB_PATHS = MOBILE_TABS.map((t) => t.to);

export function AppLayout() {
  const children = <Outlet />;
  const isMobile = useIsMobile();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const currentPath = location.pathname;
  const isOnMorePage = !MOBILE_TAB_PATHS.includes(currentPath) && ALL_ITEMS.some((i) => i.to === currentPath);

  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        {/* Page content */}
        <div className="flex-1 overflow-hidden">{children}</div>

        {/* More menu overlay */}
        {moreOpen && (
          <div className="fixed inset-0 z-50 flex flex-col">
            <div className="flex-1 bg-black/60" onClick={() => setMoreOpen(false)} />
            <div className="bg-card border-t border-border rounded-t-2xl px-4 pb-6 pt-3 safe-area-bottom max-h-[70dvh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">All Features</span>
                <button onClick={() => setMoreOpen(false)} className="p-1 rounded-full hover:bg-secondary text-muted-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="mb-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <group.icon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">{group.label}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className="flex flex-col items-center gap-1 rounded-lg py-2.5 px-1 text-muted-foreground transition-colors hover:bg-secondary"
                        activeClassName="bg-primary/10 text-primary"
                        onClick={() => setMoreOpen(false)}
                      >
                        <item.icon className="h-5 w-5" />
                        <span className="text-[10px] font-medium leading-tight text-center">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom tab bar */}
        <nav className="flex border-t border-border bg-card safe-area-bottom">
          {MOBILE_TABS.map((tab) => {
            const isActive = currentPath === tab.to;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <tab.icon className="h-5 w-5" fill={isActive ? 'currentColor' : 'none'} />
                <span className="font-medium">{tab.label}</span>
              </NavLink>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
              isOnMorePage || moreOpen ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="font-medium">More</span>
          </button>
        </nav>
      </div>
    );
  }

  // Desktop: grouped sidebar
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="flex w-52 flex-col border-r border-border bg-card overflow-y-auto scrollbar-hide">
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-xs font-bold uppercase tracking-[0.2em] text-primary">BYBIT SCANNER</h1>
        </div>
        <div className="flex-1 py-2 px-2 space-y-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-1.5 px-2 mb-1">
                <group.icon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</span>
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    activeClassName="bg-primary/10 text-primary font-medium"
                  >
                    <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
