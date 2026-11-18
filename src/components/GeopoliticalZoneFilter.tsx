import React from 'react';
import { ZONES } from '../data/nigeriaData';
import { GeopoliticalZoneCode } from '../types';
import { Layers } from 'lucide-react';

interface GeopoliticalZoneFilterProps {
  activeZone: GeopoliticalZoneCode | 'ALL';
  onSelectZone: (zone: GeopoliticalZoneCode | 'ALL') => void;
  zoneCounts: Record<GeopoliticalZoneCode, number>;
}

export const GeopoliticalZoneFilter: React.FC<GeopoliticalZoneFilterProps> = ({
  activeZone,
  onSelectZone,
  zoneCounts,
}) => {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 py-3 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
          <Layers className="w-3.5 h-3.5 text-emerald-600" />
          <span>Geopolitical Zones:</span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => onSelectZone('ALL')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
              activeZone === 'ALL'
                ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            All Nigeria
          </button>

          {(Object.keys(ZONES) as GeopoliticalZoneCode[]).map((zoneCode) => {
            const zone = ZONES[zoneCode];
            const isSelected = activeZone === zoneCode;
            const count = zoneCounts[zoneCode] || 0;

            return (
              <button
                key={zoneCode}
                onClick={() => onSelectZone(zoneCode)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer shrink-0 border ${
                  isSelected
                    ? 'border-emerald-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
                }`}
                style={{
                  backgroundColor: isSelected ? zone.color : undefined,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: isSelected ? '#ffffff' : zone.color }}
                />
                <span>{zone.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-black/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
