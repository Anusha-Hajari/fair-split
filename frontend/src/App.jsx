import React, { useState, useId } from 'react';
import { 
  Upload, AlertTriangle, RefreshCw, 
  ShieldAlert, Plus, Trash2, Edit3, QrCode as QrIcon 
} from 'lucide-react';
import QRCode from 'qrcode';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'https://fairsplit-api-c978.onrender.com';

export default function App() {
  const fileInputId = useId();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Dynamic currency with strict character sanitation
  const [currency, setCurrency] = useState('₹');

  // Extracted Bill Data
  const [items, setItems] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [discrepancy, setDiscrepancy] = useState(null);

  // Group Management & Assignments
  const [participants, setParticipants] = useState(['Alice', 'Bob', 'Charlie']);
  const [newMember, setNewMember] = useState('');
  const [assignments, setAssignments] = useState({});
  const [targetTotal, setTargetTotal] = useState(null);

  // Settlements & Real-Time QR
  const [settlements, setSettlements] = useState([]);
  const [upiId, setUpiId] = useState('host@upi');
  const [qrMap, setQrMap] = useState({});

  const roundTwo = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

  const runDiscrepancyCheck = (currentItems, currentMeta) => {
    if (!currentMeta) return;
    const sumCalculated = roundTwo(currentItems.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0));
    const printedSub = Number(currentMeta.subtotal) || 0;
    const diff = roundTwo(Math.abs(sumCalculated - printedSub));

    if (diff > 1.0) {
      setDiscrepancy({
        calculated: sumCalculated,
        printed: printedSub,
        diff: diff
      });
    } else {
      setDiscrepancy(null);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setErrorMsg('');

    const formData = new FormData();
    if (files[0]) formData.append('image', files[0]);
    if (files[1]) formData.append('image_part2', files[1]);

    try {
      const res = await fetch(`${API_BASE_URL}/api/extract`, {
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
      setTargetTotal(data.metadata?.printed_total || data.calculated_subtotal);

      // Currency hallucination shield
      if (data.metadata?.currency_symbol) {
        const rawSym = String(data.metadata.currency_symbol).trim();
        if (rawSym.includes('$')) setCurrency('$');
        else if (rawSym.includes('€')) setCurrency('€');
        else if (rawSym.includes('£')) setCurrency('£');
        else if (rawSym.length <= 3) setCurrency(rawSym);
        else setCurrency('₹');
      }

      if (data.is_discrepancy_detected) {
        setDiscrepancy({
          calculated: data.calculated_subtotal,
          printed: data.metadata.subtotal,
          diff: data.discrepancy_amount
        });
      } else {
        setDiscrepancy(null);
      }

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

  const handleItemFieldChange = (index, field, value) => {
    const updated = [...items];
    const targetItem = { ...updated[index] };

    if (field === 'name') {
      targetItem.name = value;
    } else if (field === 'quantity') {
      const qty = parseFloat(value) || 0;
      targetItem.quantity = qty;
      targetItem.total_price = roundTwo(qty * (targetItem.unit_price || 0));
    } else if (field === 'unit_price') {
      const uPrice = parseFloat(value) || 0;
      targetItem.unit_price = uPrice;
      targetItem.total_price = roundTwo((targetItem.quantity || 1) * uPrice);
    } else if (field === 'total_price') {
      const tPrice = parseFloat(value) || 0;
      targetItem.total_price = tPrice;
      if (targetItem.quantity && targetItem.quantity > 0) {
        targetItem.unit_price = roundTwo(tPrice / targetItem.quantity);
      }
    }

    updated[index] = targetItem;
    setItems(updated);
    runDiscrepancyCheck(updated, metadata);
  };

  const removeItem = (index) => {
    const targetId = items[index].id;
    const updated = items.filter((_, i) => i !== index);
    setItems(updated);

    const nextAssign = { ...assignments };
    delete nextAssign[targetId];
    setAssignments(nextAssign);

    runDiscrepancyCheck(updated, metadata);
  };

  const addNewItem = () => {
    const newId = `manual_item_${Date.now()}`;
    const newItem = {
      id: newId,
      name: 'New Custom Item',
      quantity: 1,
      unit_price: 0.0,
      total_price: 0.0,
      confidence: 1.0,
      is_alcohol: false
    };
    const updated = [...items, newItem];
    setItems(updated);
    setAssignments({ ...assignments, [newId]: [] });
    runDiscrepancyCheck(updated, metadata);
  };

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

  const toggleAssignment = (itemId, person) => {
    const current = assignments[itemId] || [];
    const next = current.includes(person)
      ? current.filter((p) => p !== person)
      : [...current, person];
    setAssignments({ ...assignments, [itemId]: next });
  };

  const generateQRCodes = async (settlementList, vpa) => {
    const qrs = {};
    for (const p of settlementList) {
      if (p.total_payable > 0) {
        const upiUrl = `upi://pay?pa=${vpa}&pn=FairSplit&am=${p.total_payable}&cu=INR&tn=Bill%20Share`;
        qrs[p.name] = await QRCode.toDataURL(upiUrl);
      }
    }
    setQrMap(qrs);
  };

  const handleCalculateSplit = async () => {
    setLoading(true);
    setErrorMsg('');

    const finalTarget = (targetTotal && targetTotal > 0) ? targetTotal : metadata?.printed_total;

    const payload = {
      items: items.map((item) => ({
        id: item.id,
        price: Number(item.total_price),
        assigned_to: assignments[item.id] || []
      })),
      metadata: metadata,
      participants: participants,
      target_total: finalTarget
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to run split calculation');

      const data = await res.json();
      setSettlements(data);
      await generateQRCodes(data, upiId);
      setStep(4);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpiChange = async (newVpa) => {
    setUpiId(newVpa);
    if (settlements.length > 0) {
      await generateQRCodes(settlements, newVpa);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-indigo-950 pb-4">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-purple-300 to-cyan-300 bg-clip-text text-transparent">
              FairSplit Engine
            </h1>
            <p className="text-xs text-slate-400">Zero-leakage Hamilton split with proportional taxes</p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-800/60 text-indigo-300">
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
          <div className="p-10 border-2 border-dashed border-indigo-900/60 hover:border-cyan-500/50 transition-all rounded-2xl bg-indigo-950/20 flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-4 bg-indigo-950/60 border border-indigo-800/80 rounded-2xl text-cyan-400 shadow-inner">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Upload Receipt Photo(s)</h2>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Upload single or multi-part photos. Automatically handles taxes, service fees, and discounts.
              </p>
            </div>
            <label htmlFor={fileInputId} className="cursor-pointer bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-indigo-950/60 inline-block">
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
              <div className="flex items-center gap-2 text-xs text-cyan-400 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Forensic OCR parsing in progress...
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Forensic Review & Inline Editing */}
        {step === 2 && (
          <div className="space-y-4">
            {discrepancy && (
              <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    Receipt Math Discrepancy Detected (Broken Total Trap)
                  </div>
                  <span className="text-xs font-mono bg-indigo-950 border border-indigo-800 text-indigo-300 px-2 py-0.5 rounded">
                    Target Grand Total: {currency}{targetTotal?.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Sum of line items is <strong>{currency}{discrepancy.calculated}</strong>, but printed receipt subtotal indicates <strong>{currency}{discrepancy.printed}</strong> (Mismatch: {currency}{discrepancy.diff}).
                </p>
                <div className="flex gap-2 pt-1 text-xs">
                  <button 
                    onClick={() => {
                      setTargetTotal(metadata?.printed_total || discrepancy.calculated);
                      setDiscrepancy(null);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-all shadow-md"
                  >
                    ✓ Reconcile & Use Printed Total ({currency}{metadata?.printed_total?.toFixed(2)})
                  </button>
                  <button 
                    onClick={() => {
                      const adjusted = (metadata?.printed_total || 0) + (discrepancy.calculated - discrepancy.printed);
                      setTargetTotal(adjusted);
                      setDiscrepancy(null);
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-all"
                  >
                    Trust Line Items (Adjust Overheads)
                  </button>
                </div>
              </div>
            )}

            <div className="bg-[#111625] border border-indigo-950 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-3.5 bg-indigo-950/40 border-b border-indigo-950 flex justify-between items-center text-xs text-slate-300 font-semibold uppercase tracking-wider">
                <span className="flex items-center gap-2">
                  <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                  Review & Edit Extracted Items
                </span>
                <span className="text-cyan-400 font-mono">
                  Current Sum: {currency}{items.reduce((acc, i) => acc + (Number(i.total_price) || 0), 0).toFixed(2)}
                </span>
              </div>

              {/* Table Column Headers */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-950/40 text-[11px] font-mono text-slate-400 border-b border-indigo-950">
                <span className="col-span-6">Item Description</span>
                <span className="col-span-2 text-center">Qty</span>
                <span className="col-span-3 text-right">Total ({currency})</span>
                <span className="col-span-1 text-center">Del</span>
              </div>

              <div className="divide-y divide-indigo-950/60 max-h-96 overflow-y-auto">
                {items.map((item, idx) => (
                  <div key={item.id || idx} className="p-3 grid grid-cols-12 gap-2 items-center text-sm">
                    {/* Item Name Input */}
                    <div className="col-span-6 flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500 w-5">#{idx + 1}</span>
                      <input 
                        type="text"
                        value={item.name}
                        onChange={(e) => handleItemFieldChange(idx, 'name', e.target.value)}
                        className="bg-slate-950/80 border border-indigo-950 focus:border-cyan-500 rounded-lg px-2.5 py-1 text-slate-200 text-xs w-full focus:outline-none"
                      />
                      {item.is_alcohol && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-950/80 border border-purple-800 text-purple-300 font-mono shrink-0">
                          VAT
                        </span>
                      )}
                      {item.confidence < 0.7 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/80 border border-rose-800 text-rose-300 font-mono shrink-0">
                          Low Conf
                        </span>
                      )}
                    </div>

                    {/* Quantity Input */}
                    <div className="col-span-2">
                      <input 
                        type="number"
                        step="any"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => handleItemFieldChange(idx, 'quantity', e.target.value)}
                        className="bg-slate-950/80 border border-indigo-950 focus:border-cyan-500 rounded-lg px-2 py-1 text-slate-200 text-xs text-center w-full focus:outline-none font-mono"
                      />
                    </div>

                    {/* Total Price Input */}
                    <div className="col-span-3">
                      <input 
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.total_price}
                        onChange={(e) => handleItemFieldChange(idx, 'total_price', e.target.value)}
                        className="bg-slate-950/80 border border-indigo-950 focus:border-cyan-500 rounded-lg px-2 py-1 text-cyan-400 font-mono text-xs text-right w-full focus:outline-none font-semibold"
                      />
                    </div>

                    {/* Delete Item Button */}
                    <div className="col-span-1 text-center">
                      <button 
                        onClick={() => removeItem(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                        title="Delete line item"
                      >
                        <Trash2 className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add New Line Item Row */}
              <div className="p-3 bg-slate-950/30 border-t border-indigo-950 flex justify-between items-center">
                <button 
                  onClick={addNewItem}
                  className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Missing Item
                </button>
                <span className="text-[11px] text-slate-500 font-mono">
                  {items.length} items verified
                </span>
              </div>
            </div>

            {/* Stage 2 Navigation Controls (Back & Continue) */}
            <div className="flex gap-3">
              <button 
                onClick={() => setStep(1)}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all border border-indigo-950"
              >
                ← Back to Upload
              </button>
              <button 
                onClick={() => setStep(3)}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 font-medium py-3 rounded-xl text-sm transition-all shadow-lg shadow-indigo-950/50"
              >
                Continue to Member Tagging
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Assign & Claim Items */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="p-4 bg-[#111625] border border-indigo-950 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 uppercase">Party Members</span>
                <span className="text-slate-500 font-mono">{participants.length} added</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <span key={p} className="flex items-center gap-1.5 px-3 py-1 bg-indigo-950/50 rounded-full text-xs border border-indigo-800/60 text-slate-200">
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
                  className="bg-slate-950 border border-indigo-950 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 flex-1"
                />
                <button onClick={addParticipant} className="px-4 py-1.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 text-xs font-medium rounded-xl text-indigo-200">
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
                    <div key={item.id} className="p-4 bg-[#111625] border border-indigo-950 rounded-2xl space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium text-slate-200">{item.name}</span>
                        <span className="font-mono text-cyan-400 font-semibold">{currency}{Number(item.total_price).toFixed(2)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {participants.map((person) => {
                          const isPicked = assigned.includes(person);
                          return (
                            <button
                              key={person}
                              onClick={() => toggleAssignment(item.id, person)}
                              className={`text-xs px-3 py-1 rounded-lg transition-all ${
                                isPicked 
                                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md shadow-indigo-950' 
                                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 border border-indigo-950'
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

            {/* Stage 3 Navigation Controls (Back & Calculate) */}
            <div className="flex gap-3">
              <button 
                onClick={() => setStep(2)}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all border border-indigo-950"
              >
                ← Back to Edit Items
              </button>
              <button 
                onClick={handleCalculateSplit}
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 font-medium py-3 rounded-xl text-sm transition-all shadow-lg shadow-indigo-950/60"
              >
                {loading ? 'Executing Hamilton Rounding...' : 'Calculate Proportional Split'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Final Settlement & UPI Breakdown */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Settlement Ledger</h2>
                <p className="text-xs text-slate-400">Zero penny leakage (Target: {currency}{targetTotal?.toFixed(2)})</p>
              </div>
              <button 
                onClick={() => setStep(3)} 
                className="text-xs text-cyan-400 hover:text-cyan-300 underline"
              >
                Edit Claims
              </button>
            </div>

            {/* Configurable UPI ID for live transfers */}
            {currency === '₹' && (
              <div className="p-3 bg-[#111625] border border-indigo-950 rounded-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
                  <QrIcon className="w-4 h-4 text-cyan-400" />
                  <span>Host UPI VPA:</span>
                </div>
                <input 
                  type="text"
                  value={upiId}
                  onChange={(e) => handleUpiChange(e.target.value)}
                  placeholder="e.g. username@okhdfcbank"
                  className="bg-slate-950 border border-indigo-950 focus:border-cyan-500 text-slate-200 text-xs px-3 py-1.5 rounded-lg font-mono focus:outline-none flex-1 max-w-xs"
                />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {settlements.map((res) => (
                <div key={res.name} className="p-4 bg-[#111625] border border-indigo-950 rounded-2xl space-y-3 shadow-lg">
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold base text-slate-200">{res.name}</span>
                    <span className="font-mono text-xl font-bold text-cyan-400">{currency}{res.total_payable.toFixed(2)}</span>
                  </div>
                  <div className="text-xs space-y-1 text-slate-400 font-mono border-t border-indigo-950/80 pt-2">
                    <div className="flex justify-between">
                      <span>Base Food Consumed:</span>
                      <span>{currency}{res.food_base.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Proportional Tax & Charges:</span>
                      <span>{currency}{res.proportional_overhead.toFixed(2)}</span>
                    </div>
                    {res.saved_vs_equal_split > 0 && (
                      <div className="flex justify-between text-cyan-300">
                        <span>Saved vs Equal Split:</span>
                        <span>-{currency}{res.saved_vs_equal_split.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  {currency === '₹' && qrMap[res.name] && (
                    <div className="pt-2 flex flex-col items-center">
                      <img src={qrMap[res.name]} alt="UPI QR" className="w-28 h-28 rounded-xl bg-white p-1 shadow" />
                      <span className="text-[10px] text-slate-500 mt-1 font-mono">Scan to Pay via UPI</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button 
              onClick={() => setStep(1)} 
              className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium py-3 rounded-xl text-xs transition-colors border border-indigo-950"
            >
              Start New Bill
            </button>
          </div>
        )}

      </div>
    </div>
  );
}