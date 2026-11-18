import { useModal } from '../hooks/useModal';
import React, { useState } from 'react';
import { X, MapPin, Search, ChevronRight, Compass } from 'lucide-react';
import { STATES_DATA, ZONES } from '../data/nigeriaData';
import { GeopoliticalZoneCode } from '../types';

interface StateExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectState: (stateName: string) => void;
  stateCounts: Record<string, number>;
}

const StateExplorer: React.FC<StateExplorerModalProps> = ({
  onClose,
  onSelectState,
  stateCounts,
}) => {
  useModal(onClose);

  const [query, setQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState<GeopoliticalZoneCode | 'ALL'>('ALL');

  const filteredStates = STATES_DATA.filter((state) => {
    const matchesQuery =
      state.name.toLowerCase().includes(query.toLowerCase()) ||
      state.capital.toLowerCase().includes(query.toLowerCase()) ||
      state.lgas.some((l) => l.toLowerCase().includes(query.toLowerCase()));

    const matchesZone = selectedZone === 'ALL' || state.zone === selectedZone;
    return matchesQuery && matchesZone;
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-6 max-h-[90vh] flex flex-col"
        role="dialog" aria-modal="true" aria-label="Browse states"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-cyan-800 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Compass className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="font-extrabold text-lg sm:text-xl">Nigeria 36 States & FCT Explorer</h2>
              <p className="text-xs text-emerald-100">
                Browse businesses by state, capital city, and local government council.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter / Search Bar */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by state name, capital (e.g. Ikeja, Uyo), or LGA..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
            />
          </div>

          {/* Zone tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              onClick={() => setSelectedZone('ALL')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
                selectedZone === 'ALL'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              All Zones
            </button>
            {(Object.keys(ZONES) as GeopoliticalZoneCode[]).map((z) => (
              <button
                key={z}
                onClick={() => setSelectedZone(z)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
                  selectedZone === z
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {ZONES[z].name}
              </button>
            ))}
          </div>
        </div>

        {/* States Grid */}
        <div className="p-5 sm:p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 flex-1">
          {filteredStates.map((state) => {
            const count = stateCounts[state.name] || 0;
            const zone = ZONES[state.zone];

            return (
              <button
                key={state.key}
                onClick={() => {
                  onSelectState(state.name);
                  onClose();
                }}
                className="group text-left p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded text-white"
                      style={{ backgroundColor: zone.color }}
                    >
                      {zone.name}
                    </span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {count} {count === 1 ? 'business' : 'businesses'}
                    </span>
                  </div>

                  <h3 className="font-black text-base text-slate-900 dark:text-white mt-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {state.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Capital: <b>{state.capital}</b>
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[11px] text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 font-semibold">
                  <span>{state.lgas.length} LGAs</span>
                  <span className="flex items-center gap-0.5">
                    Explore listings <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
          Showing {filteredStates.length} of {STATES_DATA.length} jurisdictions
        </div>
      </div>
    </div>
  );
};

export const StateExplorerModal: React.FC<StateExplorerModalProps> = (props) =>
  props.isOpen ? <StateExplorer {...props} /> : null;
