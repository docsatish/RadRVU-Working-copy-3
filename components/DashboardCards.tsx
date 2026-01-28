
import React from 'react';

interface Props {
  totalRVU: number;
  totalEarnings: number;
  studyCount: number;
  rvuRate: number;
}

const DashboardCards: React.FC<Props> = ({ totalRVU, totalEarnings, studyCount, rvuRate }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Total wRVUs</p>
        <p className="text-3xl font-bold text-indigo-600 font-mono">{totalRVU.toFixed(2)}</p>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Est. Earnings</p>
        <p className="text-3xl font-bold text-emerald-600 font-mono">${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Total Studies</p>
        <p className="text-3xl font-bold text-slate-800 font-mono">{studyCount}</p>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">$/RVU Rate</p>
        <p className="text-3xl font-bold text-slate-800 font-mono">${rvuRate.toFixed(2)}</p>
      </div>
    </div>
  );
};

export default DashboardCards;
