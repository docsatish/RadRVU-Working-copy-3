
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { INITIAL_STUDY_DB, DEFAULT_RVU_RATE } from './constants';
import { ScannedStudy, CalculationResults, StudyDefinition } from './types';
import { performOCRAndMatch } from './services/geminiService';
import DashboardCards from './components/DashboardCards';
import StudyTable from './components/StudyTable';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import heic2any from 'heic2any';

const ABBREVIATIONS: Record<string, string> = {
  'us': 'ultrasound',
  'usg': 'ultrasound',
  'ultrasonic': 'ultrasound',
  'bx': 'biopsy',
  'mammo': 'mammogram',
  'mammography': 'mammogram',
  'xr': 'xray',
  'cr': 'xray',
  'dr': 'xray',
  'mr': 'mri',
  'fu': 'followup',
  'followup': 'followup',
  'ltd': 'limited',
  'scr': 'screening',
  'scrn': 'screening',
  'dx': 'diagnostic',
  'diag': 'diagnostic',
  'bil': 'bilateral',
  'bilat': 'bilateral',
  'unilat': 'unilateral',
  'w': 'with',
  'wo': 'without',
  'cont': 'contrast',
  'thor': 'thoracic',
  'abd': 'abdomen',
  'pelv': 'pelvis',
  'ang': 'angio',
  'cerv': 'cervical',
  'lumb': 'lumbar',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'database'>('dashboard');
  const [db, setDb] = useState<StudyDefinition[]>(INITIAL_STUDY_DB);
  const [studies, setStudies] = useState<ScannedStudy[]>([]);
  const [isGrouped, setIsGrouped] = useState(false);
  const [rvuRate, setRvuRate] = useState<number>(DEFAULT_RVU_RATE);
  const [isScanning, setIsScanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report Metadata
  const [doctorName, setDoctorName] = useState(localStorage.getItem('rad_doctorName') || '');
  const [groupName, setGroupName] = useState(localStorage.getItem('rad_groupName') || '');
  const [hospitalName, setHospitalName] = useState(localStorage.getItem('rad_hospitalName') || '');
  
  // Image Inspection State - Only in memory to avoid QuotaExceededError
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem('rad_doctorName', doctorName);
    localStorage.setItem('rad_groupName', groupName);
    localStorage.setItem('rad_hospitalName', hospitalName);
  }, [doctorName, groupName, hospitalName]);

  useEffect(() => {
    const savedStudies = localStorage.getItem('rad_studies');
    if (savedStudies) {
      try {
        setStudies(JSON.parse(savedStudies));
      } catch (e) {
        console.error("Failed to load saved studies", e);
      }
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('rad_studies', JSON.stringify(studies));
    } catch (e) {
      console.warn("Quota exceeded while saving studies. Clearing oldest entries might be required.", e);
    }
  }, [studies]);

  const displayStudies = useMemo(() => {
    if (!isGrouped) return studies;

    const groupedMap = new Map<string, ScannedStudy>();

    studies.forEach((s) => {
      const key = `${s.cpt}-${s.name}`;
      const existing = groupedMap.get(key);
      if (existing) {
        groupedMap.set(key, {
          ...existing,
          quantity: existing.quantity + s.quantity,
          confidence: Math.max(existing.confidence, s.confidence),
          originalText: undefined 
        });
      } else {
        groupedMap.set(key, { ...s });
      }
    });

    return Array.from(groupedMap.values());
  }, [studies, isGrouped]);

  const results = useMemo((): CalculationResults => {
    const totalRVU = studies.reduce((acc, s) => acc + (s.rvu * s.quantity), 0);
    return {
      totalRVU,
      totalEarnings: totalRVU * rvuRate,
      studyCount: studies.reduce((acc, s) => acc + s.quantity, 0)
    };
  }, [studies, rvuRate]);

  const normalizeToken = (t: string) => {
    const low = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ABBREVIATIONS[low] || low;
  };

  const getSignificantWords = (s: string) => {
    const lateralIgnoreSet = new Set(['lt', 'rt', 'left', 'right']);
    const fillerIgnoreSet = new Set(['the', 'and', 'for', 'or', 'of', 'in']);

    return s.toLowerCase()
      .split(/[^a-z0-9/]/)
      .filter(w => w.length > 0)
      .map(w => {
        const clean = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        return normalizeToken(clean);
      })
      .filter(w => w.length > 0 && !lateralIgnoreSet.has(w) && !fillerIgnoreSet.has(w));
  };

  const calculateWordOverlap = (s1: string, s2: string) => {
    const words1 = new Set(getSignificantWords(s1));
    const words2 = getSignificantWords(s2);
    let matches = 0;
    words2.forEach(w => {
      if (words1.has(w)) matches++;
    });
    return matches;
  };

  const processFile = useCallback(async (file: File) => {
    setIsScanning(true);
    setError(null);

    let targetFile = file;

    // Detect HEIC and convert to JPEG
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || 
                   file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

    if (isHeic) {
      try {
        const convertedBlob = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.8
        });
        const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        targetFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' });
      } catch (err) {
        console.error("HEIC Conversion error:", err);
        setError("Could not convert HEIC file. Please use JPEG or PNG.");
        setIsScanning(false);
        return;
      }
    }

    if (!targetFile.type.startsWith('image/')) {
      setError("Please upload a valid image file.");
      setIsScanning(false);
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      setLastImage(base64String);
      try {
        const extracted = await performOCRAndMatch(base64String, db);
        
        const processed: ScannedStudy[] = extracted
          .map((ex: any, index: number) => {
            let bestMatch: StudyDefinition | null = null;
            let highestOverlap = 0;

            db.forEach(dbItem => {
              const sigWordsInDb = getSignificantWords(dbItem.name);
              const overlap = calculateWordOverlap(ex.originalText || ex.name, dbItem.name);
              const threshold = Math.min(4, sigWordsInDb.length);
              
              if (overlap >= threshold && overlap > highestOverlap) {
                highestOverlap = overlap;
                bestMatch = dbItem;
              }
            });

            if (!bestMatch) {
              const normalizedExName = ex.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              bestMatch = db.find(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedExName) || null;
            }
            
            if (bestMatch) {
              return {
                id: `${Date.now()}-${index}-${Math.random()}`,
                cpt: bestMatch.cpt,
                name: bestMatch.name, 
                rvu: bestMatch.rvu,
                quantity: ex.quantity || 1,
                confidence: ex.confidence ?? 0.0,
                originalText: ex.originalText
              };
            }
            return null;
          })
          .filter(Boolean) as ScannedStudy[];

        setStudies(prev => [...prev, ...processed]);
      } catch (err) {
        setError("AI Analysis failed. Check image quality.");
        console.error(err);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(targetFile);
  }, [db]);

  const generatePDF = async () => {
    if (studies.length === 0) return;
    setIsExporting(true);
    
    try {
      const doc = new jsPDF();
      const timestamp = new Date().toLocaleString();

      // Header
      doc.setFontSize(22);
      doc.setTextColor(79, 70, 229);
      doc.text("RadRVU Professional Report", 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${timestamp}`, 14, 28);

      // Metadata Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 35, 182, 35, 3, 3, 'FD');

      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "bold");
      doc.text("PROVIDER INFORMATION", 18, 43);
      
      doc.setFont("helvetica", "normal");
      doc.text(`Physician: ${doctorName || 'Not Specified'}`, 18, 50);
      doc.text(`Radiology Group: ${groupName || 'Not Specified'}`, 18, 57);
      doc.text(`Hospital/Facility: ${hospitalName || 'Not Specified'}`, 18, 64);

      // Summary Panel
      doc.setFont("helvetica", "bold");
      doc.text("PRODUCTIVITY SUMMARY", 14, 82);
      
      const summaryData = [
        ["Total Studies", "Total wRVUs", "Conversion Rate", "Est. Earnings"],
        [
          results.studyCount.toString(),
          results.totalRVU.toFixed(2),
          `$${rvuRate.toFixed(2)}`,
          `$${results.totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        ]
      ];

      autoTable(doc, {
        startY: 86,
        head: [summaryData[0]],
        body: [summaryData[1]],
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], fontSize: 9, halign: 'center' },
        bodyStyles: { fontSize: 11, fontStyle: 'bold', halign: 'center', textColor: [30, 41, 59] }
      });

      // Study Table (Consolidated or Individual based on UI)
      const tableData = displayStudies.map(s => [
        s.cpt,
        isGrouped ? s.name : (s.originalText || s.name),
        s.quantity.toString(),
        s.rvu.toFixed(2),
        (s.rvu * s.quantity).toFixed(2)
      ]);

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['CPT Code', isGrouped ? 'Procedure Category' : 'Extracted Procedure', 'Qty', 'wRVU', 'Total']],
        body: tableData,
        headStyles: { fillColor: [51, 65, 85], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 30 },
          2: { cellWidth: 15, halign: 'center' },
          3: { cellWidth: 20, halign: 'right' },
          4: { cellWidth: 25, halign: 'right' }
        }
      });

      // Image Page - Audit Evidence
      if (lastImage) {
        doc.addPage();
        doc.setFontSize(16);
        doc.setTextColor(30, 41, 59);
        doc.setFont("helvetica", "bold");
        doc.text("Worklist Audit Evidence", 14, 20);
        
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text("The following image was used for AI data extraction and CPT matching.", 14, 26);
        
        try {
          const mimeType = lastImage.substring(5, lastImage.indexOf(';'));
          let imgFormat: 'JPEG' | 'PNG' | 'WEBP' = 'JPEG';
          if (mimeType === 'image/png') imgFormat = 'PNG';
          else if (mimeType === 'image/webp') imgFormat = 'WEBP';

          const imgProps = doc.getImageProperties(lastImage);
          const pdfPageWidth = doc.internal.pageSize.getWidth() - 28;
          const pdfPageHeight = doc.internal.pageSize.getHeight() - 50;
          
          let displayWidth = pdfPageWidth;
          let displayHeight = (imgProps.height * displayWidth) / imgProps.width;

          if (displayHeight > pdfPageHeight) {
            displayHeight = pdfPageHeight;
            displayWidth = (imgProps.width * displayHeight) / imgProps.height;
          }

          doc.addImage(lastImage, imgFormat, 14, 35, displayWidth, displayHeight, undefined, 'FAST');
        } catch (e) {
          console.error("PDF Image Inclusion Error:", e);
          doc.setTextColor(239, 68, 68);
          doc.text("Warning: Worklist image could not be embedded.", 14, 45);
        }
      }

      doc.save(`RVU_Report_${isGrouped ? 'Consolidated_' : ''}${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error("PDF Export Error", err);
      alert("Failed to generate PDF. Check console for details.");
    } finally {
      setIsExporting(false);
    }
  };

  const deleteStudy = (id: string) => setStudies(prev => prev.filter(s => s.id !== id));
  const clearAll = () => {
    if (window.confirm("Clear today's worklist?")) {
      setStudies([]);
      setLastImage(null);
      localStorage.removeItem('rad_studies');
    }
  };

  const handleMouseDown = () => zoom > 1 && setIsPanning(true);
  const handleMouseUp = () => setIsPanning(false);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPosition(prev => ({
        x: prev.x + e.movementX,
        y: prev.y + e.movementY
      }));
    }
  };

  useEffect(() => {
    if (!isModalOpen) {
      setZoom(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isModalOpen]);

  return (
    <div className="min-h-screen pb-20 px-4 md:px-8 bg-[#f8fafc]">
      <header className="max-w-7xl mx-auto py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">RadRVU Pro</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-slate-500 font-medium italic">Radiology Productivity Suite</p>
              <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">v2.5 Professional</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-white p-3 px-5 rounded-2xl shadow-sm border border-slate-200">
            <label className="text-sm font-bold text-slate-500 uppercase tracking-tight">Conv. Rate:</label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400 font-bold">$</span>
              <input 
                type="number" 
                value={rvuRate} 
                onChange={(e) => setRvuRate(parseFloat(e.target.value) || 0)}
                className="pl-7 pr-4 py-2 w-24 rounded-xl border border-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none font-mono text-indigo-600 font-bold"
              />
            </div>
          </div>
        </div>

        <div className="flex p-1 bg-slate-200/50 rounded-2xl w-fit mb-8">
          <button onClick={() => setActiveTab('dashboard')} className={`px-8 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Dashboard</button>
          <button onClick={() => setActiveTab('database')} className={`px-8 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === 'database' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>RVU Database</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        {activeTab === 'dashboard' ? (
          <>
            <DashboardCards totalRVU={results.totalRVU} totalEarnings={results.totalEarnings} studyCount={results.studyCount} rvuRate={rvuRate} />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Report Details</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Doctor Name</label>
                      <input 
                        value={doctorName} 
                        onChange={e => setDoctorName(e.target.value)}
                        placeholder="Dr. Jane Smith"
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Radiology Group</label>
                      <input 
                        value={groupName} 
                        onChange={e => setGroupName(e.target.value)}
                        placeholder="Elite Imaging LLC"
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">Hospital / Clinic</label>
                      <input 
                        value={hospitalName} 
                        onChange={e => setHospitalName(e.target.value)}
                        placeholder="General Hospital"
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div 
                  onDragOver={(e) => {e.preventDefault(); setIsDragging(true);}}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if(f) processFile(f);}}
                  className={`bg-indigo-600 rounded-3xl p-8 text-white shadow-xl relative overflow-hidden transition-all duration-300 ${isDragging ? 'scale-105 ring-4 ring-indigo-200' : ''}`}
                >
                  <h2 className="text-xl font-bold mb-4">Scan Worklist</h2>
                  <p className="text-indigo-100 mb-6 text-sm leading-relaxed">Drop a screenshot here (JPG, PNG, HEIC).</p>
                  <label className="block w-full text-center py-4 bg-white text-indigo-600 rounded-xl font-bold cursor-pointer hover:bg-indigo-50 transition-all">
                    {isScanning ? "Processing..." : "Upload Screenshot"}
                    <input type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => {const f = e.target.files?.[0]; if(f) processFile(f);}} disabled={isScanning} />
                  </label>
                  {error && <div className="mt-4 p-3 bg-red-500/20 rounded-lg text-xs font-bold text-red-50">{error}</div>}
                </div>

                {lastImage && (
                  <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm overflow-hidden group">
                    <h3 className="font-bold text-slate-800 mb-3 text-xs uppercase tracking-wider px-2">Worklist Image</h3>
                    <div 
                      className="relative rounded-2xl overflow-hidden cursor-zoom-in aspect-video bg-slate-100 border border-slate-100"
                      onClick={() => setIsModalOpen(true)}
                    >
                      <img src={lastImage} alt="Worklist thumbnail" className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500" />
                    </div>
                  </div>
                )}
                
                {studies.length > 0 && (
                  <button onClick={clearAll} className="w-full py-2 text-slate-400 hover:text-red-500 text-xs font-bold uppercase tracking-widest transition-colors">Reset Entire Worklist</button>
                )}
              </div>

              <div className="lg:col-span-2 space-y-6">
                <div className="flex justify-end">
                   {studies.length > 0 && (
                     <button 
                        onClick={generatePDF}
                        disabled={isExporting}
                        className="flex items-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm shadow-lg hover:bg-emerald-700 hover:-translate-y-1 transition-all active:translate-y-0 disabled:opacity-50 disabled:translate-y-0"
                     >
                       {isExporting ? (
                         <span className="flex items-center gap-2">
                           <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                           Generating PDF...
                         </span>
                       ) : (
                         <>
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                           Save & Download {isGrouped ? 'Consolidated' : 'Individual'} PDF
                         </>
                       )}
                     </button>
                   )}
                </div>

                <StudyTable 
                  studies={studies} 
                  displayStudies={displayStudies} 
                  isGrouped={isGrouped} 
                  setIsGrouped={setIsGrouped} 
                  onDelete={deleteStudy} 
                />
                
                {studies.length === 0 && !isScanning && (
                  <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-3xl text-slate-300 bg-white">
                    <p className="font-bold">Worklist is empty</p>
                    <p className="text-sm">Scan a list to start your report.</p>
                  </div>
                )}
                {isScanning && studies.length === 0 && (
                  <div className="space-y-4 animate-pulse">
                    {[1,2,3].map(i => <div key={i} className="h-24 bg-white border border-slate-100 rounded-3xl w-full"></div>)}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Reference RVU Database</h2>
                <p className="text-slate-500 text-sm">Matches are verified against this list.</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 text-xs uppercase tracking-widest font-black">
                  <tr>
                    <th className="px-8 py-4">CPT Code</th>
                    <th className="px-8 py-4">Description</th>
                    <th className="px-8 py-4 text-right">Work RVU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-4 font-mono font-bold text-indigo-600 text-sm">{item.cpt}</td>
                      <td className="px-8 py-4 text-sm text-slate-700 font-medium">{item.name}</td>
                      <td className="px-8 py-4 text-right font-mono font-black text-slate-900">{item.rvu.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {isModalOpen && lastImage && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">
          <div className="flex items-center justify-between p-4 bg-white/10 backdrop-blur-md border-b border-white/10">
            <h3 className="text-white font-bold px-4">Image Inspector</h3>
            <button onClick={() => setIsModalOpen(false)} className="p-2 text-white/70 hover:text-white transition-colors">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div 
            className="flex-1 overflow-hidden relative cursor-move flex items-center justify-center"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseUp}
          >
            <div
              className="transition-transform duration-75 ease-out"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                transformOrigin: 'center center'
              }}
            >
              <img ref={imageRef} src={lastImage} alt="Full Worklist" className="max-w-[90vw] max-h-[80vh] object-contain shadow-2xl pointer-events-none" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
