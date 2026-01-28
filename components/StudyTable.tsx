
import React, { useMemo } from 'react';
import { ScannedStudy } from '../types';

interface Props {
  studies: ScannedStudy[];
  displayStudies: ScannedStudy[];
  isGrouped: boolean;
  setIsGrouped: (val: boolean) => void;
  onDelete: (id: string) => void;
}

const StudyTable: React.FC<Props> = ({ studies, displayStudies, isGrouped, setIsGrouped, onDelete }) => {
  const totals = useMemo(() => {
    return studies.reduce((acc, s) => ({
      rvu: acc.rvu + (s.rvu * s.quantity),
      qty: acc.qty + s.quantity
    }), { rvu: 0, qty: 0 });
  }, [studies]);

  if (studies.length === 0) return null;

  const getConfidenceColor = (score: number) => {
    if (score >= 0.9) return 'bg-emerald-500';
    if (score >= 0.7) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const handleDelete = (study: ScannedStudy) => {
    if (isGrouped) {
      // When deleting from grouped view, delete all original items that formed this group
      const idsToDelete = studies
        .filter(s => s.cpt === study.cpt && s.name === study.name)
        .map(s => s.id);
      
      idsToDelete.forEach(id => onDelete(id));
    } else {
      onDelete(study.id);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {isGrouped ? 'Consolidated Totals' : 'Individual Scan List'}
          </h3>
          <button 
            onClick={() => setIsGrouped(!isGrouped)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-xs font-bold uppercase tracking-tight ${
              isGrouped 
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600 shadow-sm'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            {isGrouped ? 'Show Individual Items' : 'Consolidate List'}
          </button>
        </div>
        
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest font-bold text-slate-400">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Match</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Probable</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Check</div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-6 py-3 font-semibold">CPT</th>
              <th className="px-6 py-3 font-semibold">
                {isGrouped ? 'Procedure Category' : 'Extracted Text'}
              </th>
              <th className="px-6 py-3 font-semibold">Qty</th>
              <th className="px-6 py-3 font-semibold">wRVU</th>
              <th className="px-6 py-3 font-semibold">Subtotal</th>
              <th className="px-6 py-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayStudies.map((study) => (
              <tr key={study.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span 
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${getConfidenceColor(study.confidence)}`}
                      title={`Match Confidence: ${Math.round(study.confidence * 100)}%`}
                    ></span>
                    <span className="font-mono text-sm text-indigo-600 font-semibold">{study.cpt}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {isGrouped ? (
                    <div className="text-sm font-bold text-slate-900 leading-tight">
                      {study.name}
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-bold text-slate-900 leading-tight">
                        {study.originalText || study.name}
                      </div>
                      <div className="text-[10px] text-indigo-500 font-bold uppercase tracking-tighter mt-1 opacity-70">
                        Match: {study.name}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-6 py-4">
                   <div className="flex items-center gap-2">
                     <span className={`text-sm font-medium ${isGrouped && study.quantity > 1 ? 'text-indigo-600 font-bold' : 'text-slate-600'}`}>
                       {study.quantity}
                     </span>
                     {isGrouped && study.quantity > 1 && (
                       <span className="text-[9px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Total</span>
                     )}
                   </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 font-mono">{study.rvu.toFixed(2)}</td>
                <td className="px-6 py-4 text-sm font-black text-slate-900 font-mono">{(study.rvu * study.quantity).toFixed(2)}</td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => handleDelete(study)}
                    className="text-red-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-all"
                    title={isGrouped ? "Remove all instances of this study" : "Remove from list"}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50/80 border-t border-slate-200">
            <tr>
              <td colSpan={2} className="px-6 py-4 text-sm font-bold text-slate-500 uppercase tracking-wider text-right">
                {isGrouped ? 'Consolidated Totals' : 'List Totals'}
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Total Studies</span>
                  <span className="text-sm font-black text-slate-900">{totals.qty}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-slate-400 font-mono">---</td>
              <td className="px-6 py-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">Total wRVU</span>
                  <span className="text-base font-black text-indigo-600 font-mono">{totals.rvu.toFixed(2)}</span>
                </div>
              </td>
              <td className="px-6 py-4"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default StudyTable;
