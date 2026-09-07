import React, { useState, useEffect, useId } from 'react';
import { 
  Upload, Users, AlertTriangle, CheckCircle, RefreshCw, 
  QrCode, ArrowRight, DollarSign, ShieldAlert, Sparkles 
} from 'lucide-react';
import QRCode from 'qrcode';

export default function App() {
  const fileInputId = useId();
  // Application stages: 1: Upload, 2: Review/Edit, 3: Claim Items, 4: Settle
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Extracted Bill Data
  const [items, setItems] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [discrepancy, setDiscrepancy] = useState(null);

  // Group Management & Assignments
  const [participants, setParticipants] = useState(['Alice', 'Bob', 'Charlie']);
  const [newMember, setNewMember] = useState('');
  const [assignments, setAssignments] = useState({}); // { itemId: ['Alice', 'Bob'] }
  const [targetTotal, setTargetTotal] = useState(null);

  // Settlements & QR
  const [settlements, setSettlements] = useState([]);
  const [upiId, setUpiId] = useState('host@upi');
  const [qrMap, setQrMap] = useState({});

  // 1. Upload & OCR extraction
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setErrorMsg('');

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('images', files[i]);
    }

    try {
      const res = await fetch('http://127.0.0.1:8000/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract bill data');
      }

      const data = await res.json();
      setItems(data.items);
      setMetadata(data.metadata);
      setTargetTotal(data.metadata.printed_total);

      if (data.is_discrepancy_detected) {
        setDiscrepancy({
          calculated: data.calculated_subtotal,
          printed: data.metadata.subtotal,
          diff: data.discrepancy_amount
        });
      }

      // Initialize default empty assignments
      const initAssign = {};
      data.items.forEach((item) => {
        initAssign[item.id] = [];
      });
      setAssignments(initAssign);

      setStep(2);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Add / Remove Participants
  const addParticipant = () => {
    const trimmed = newMember.trim();
    if (trimmed && !participants.includes(trimmed)) {
      setParticipants([...participants, trimmed]);
      setNewMember('');
    }
  };

  const removeParticipant = (name) => {
    setParticipants(participants.filter((p) => p !== name));
    const nextAssign = { ...assignments };
    Object.keys(nextAssign).forEach((id) => {
      nextAssign[id] = nextAssign[id].filter((p) => p !== name);
    });
    setAssignments(nextAssign);
  };

  // Toggle item claim for a participant
  const toggleAssignment = (itemId, person) => {
    const current = assignments[itemId] || [];
    const next = current.includes(person)
      ? current.filter((p) => p !== person)
      : [...current, person];
    setAssignments({ ...assignments, [itemId]: next });
  };

  // 3. Compute Proportional Settlement via backend engine
  const handleCalculateSplit = async () => {
    setLoading(true);
    setErrorMsg('');

    const payload = {
      items: items.map((item) => ({
        id: item.id,
        price: item.total_price,
        assigned_to: assignments[item.id] || []
      })),
      metadata: metadata,
      participants: participants,
      target_total: targetTotal
    };

    try {
      const res = await fetch('http://127.0.0.1:8000/api/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to run split calculation');

      const data = await res.json();
      setSettlements(data);

      // Generate UPI payment QRs
      const qrs = {};
      for (const p of data) {
        if (p.total_payable > 0) {
          const upiUrl = `upi://pay?pa=${upiId}&pn=FairSplit&am=${p.total_payable}&cu=INR&tn=Bill%20Share`;
          qrs[p.name] = await QRCode.toDataURL(upiUrl);
        }
      }
      setQrMap(qrs);
      setStep(4);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
              FairSplit Engine
            </h1>
            <p className="text-xs text-slate-400">Zero-leakage Hamilton split with proportional taxes</p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
              Stage: {step}/4
            </span>
          </div>
        </header>

        {errorMsg && (
          <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-rose-300 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* STEP 1: Upload Bills */}
        {step === 1 && (
          <div className="p-8 border-2 border-dashed border-slate-800 hover:border-emerald-500/50 transition-colors rounded-2xl bg-slate-900/30 flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-full text-emerald-400">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-200">Upload Receipt Photo(s)</h2>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Upload single or multi-part photos. Handles faded thermal paper, handwritten notes, and GST breakouts.
              </p>
            </div>
            <label htmlFor={fileInputId} className="cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-all shadow-lg shadow-emerald-950/40 inline-block">
              Select Photos
            </label>
            <input 
              id={fileInputId}
              type="file" 
              multiple 
              accept="image/*" 
              className="hidden" 
              onChange={handleFileUpload} 
            />
            {loading && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Forensic OCR parsing in progress...
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Forensic Review & Broken Total Trap */}
        {step === 2 && (
          <div className="space-y-4">
            {discrepancy && (
              <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  Receipt Math Discrepancy Detected (Broken Total Trap)
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Sum of line items is <strong>₹{discrepancy.calculated}</strong>, but printed subtotal says <strong>₹{discrepancy.printed}</strong> (Mismatch: ₹{discrepancy.diff}).
                </p>
                <div className="flex gap-2 pt-2 text-xs">
                  <button 
                    onClick={() => setTargetTotal(discrepancy.calculated)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-black font-semibold rounded"
                  >
                    Trust Line Items (₹{discrepancy.calculated})
                  </button>
                  <button 
                    onClick={() => setTargetTotal(discrepancy.printed)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                  >
                    Trust Printed Total (₹{discrepancy.printed})
                  </button>
                </div>
              </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-3 bg-slate-800/60 font-semibold text-xs text-slate-300 uppercase tracking-wider">
                Extracted Line Items
              </div>
              <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto">
                {items.map((item, idx) => (
                  <div key={item.id || idx} className="p-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500 w-6">#{idx + 1}</span>
                      <span className="font-medium text-slate-200">{item.name}</span>
                      {item.is_alcohol && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-950 border border-purple-800 text-purple-300 font-mono">
                          VAT 20%
                        </span>
                      )}
                      {item.confidence < 0.7 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 border border-rose-800 text-rose-300 font-mono">
                          Low OCR Conf
                        </span>
                      )}
                    </div>
                    <div className="font-mono font-semibold text-emerald-400">
                      ₹{item.total_price.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button 
              onClick={() => setStep(3)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 font-medium py-2.5 rounded-lg text-sm transition-all"
            >
              Continue to Member Tagging
            </button>
          </div>
        )}

        {/* STEP 3: Assign & Claim Items */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Participants Bar */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 uppercase">Party Members</span>
                <span className="text-slate-500">{participants.length} added</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <span key={p} className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full text-xs border border-slate-700">
                    <span>{p}</span>
                    <button onClick={() => removeParticipant(p)} className="text-slate-500 hover:text-rose-400">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Add friend's name..." 
                  value={newMember} 
                  onChange={(e) => setNewMember(e.target.value)} 
                  onKeyDown={(e) => e.key === 'Enter' && addParticipant()}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 flex-1"
                />
                <button onClick={addParticipant} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-lg">
                  Add
                </button>
              </div>
            </div>

            {/* Line Item Tagging */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Tap Members Who Shared Each Item
              </div>
              <div className="grid gap-3">
                {items.map((item) => {
                  const assigned = assignments[item.id] || [];
                  return (
                    <div key={item.id} className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium text-slate-200">{item.name}</span>
                        <span className="font-mono text-emerald-400 font-semibold">₹{item.total_price.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {participants.map((person) => {
                          const isPicked = assigned.includes(person);
                          return (
                            <button
                              key={person}
                              onClick={() => toggleAssignment(item.id, person)}
                              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                                isPicked 
                                  ? 'bg-emerald-600 text-white font-medium' 
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                              }`}
                            >
                              {person}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button 
              onClick={handleCalculateSplit}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 font-medium py-3 rounded-lg text-sm transition-all shadow-lg shadow-emerald-950/40"
            >
              {loading ? 'Executing Hamilton Rounding...' : 'Calculate Proportional Split'}
            </button>
          </div>
        )}

        {/* STEP 4: Final Settlement & UPI Breakdown */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Settlement Ledger</h2>
                <p className="text-xs text-slate-400">Exact penny balance with zero leakages</p>
              </div>
              <button 
                onClick={() => setStep(3)} 
                className="text-xs text-slate-400 hover:text-slate-200 underline"
              >
                Edit Claims
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {settlements.map((res) => (
                <div key={res.name} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-base text-slate-200">{res.name}</span>
                    <span className="font-mono text-xl font-bold text-emerald-400">₹{res.total_payable.toFixed(2)}</span>
                  </div>
                  <div className="text-xs space-y-1 text-slate-400 font-mono border-t border-slate-800/80 pt-2">
                    <div className="flex justify-between">
                      <span>Base Food Consumed:</span>
                      <span>₹{res.food_base.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Proportional Tax & Charges:</span>
                      <span>₹{res.proportional_overhead.toFixed(2)}</span>
                    </div>
                    {res.saved_vs_equal_split > 0 && (
                      <div className="flex justify-between text-emerald-400">
                        <span>Saved vs Equal Split:</span>
                        <span>-₹{res.saved_vs_equal_split.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  {qrMap[res.name] && (
                    <div className="pt-2 flex flex-col items-center">
                      <img src={qrMap[res.name]} alt="UPI QR" className="w-28 h-28 rounded-lg bg-white p-1" />
                      <span className="text-[10px] text-slate-500 mt-1 font-mono">Scan to Pay via UPI</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button 
              onClick={() => setStep(1)} 
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-2.5 rounded-lg text-xs transition-colors"
            >
              Start New Bill
            </button>
          </div>
        )}

      </div>
    </div>
  );
}