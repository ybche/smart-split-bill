import React, { useState, useEffect } from "react";
import { 
  CheckCircle, Clock, AlertTriangle, XCircle, Copy, Check, QrCode, 
  FileUp, RefreshCw, Send, AlertCircle, Sparkles, LogIn, Landmark, 
  CreditCard, Smartphone, CheckSquare, Square, Info, X, ChevronDown, ChevronUp, Pencil
} from "lucide-react";
import { PaymentMethod } from "../types";

interface PayPortalProps {
  token: string; // The personal token from the URL (e.g. pay/:token)
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

const getItemParticipantInfo = (it: any, currentParticipantName?: string) => {
  let list: string[] = [];
  if (it.sharedByNames && Array.isArray(it.sharedByNames) && it.sharedByNames.length > 0) {
    list = it.sharedByNames;
  } else {
    const names: string[] = [];
    if (currentParticipantName) {
      names.push(currentParticipantName);
    }
    if (it.sharesWith && Array.isArray(it.sharesWith)) {
      it.sharesWith.forEach((sw: any) => {
        const name = sw.nickname || sw.fullName;
        if (name && !names.includes(name)) {
          names.push(name);
        }
      });
    }
    list = names;
  }

  const count = list.length;
  const namesString = list.length > 0 ? list.join(", ") : (currentParticipantName || "Semua Peserta");
  return { namesString, count };
};

const getItemParticipantNames = (it: any, currentParticipantName?: string) => {
  return getItemParticipantInfo(it, currentParticipantName).namesString;
};

export default function PayPortal({ token, onShowNotification }: PayPortalProps) {
  const [loading, setLoading] = useState(true);
  const [portalData, setPortalData] = useState<any | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState("");

  // Submitting Declaration Form state
  const [payAll, setPayAll] = useState(true);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [declaredAmount, setDeclaredAmount] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [proofBase64, setProofBase64] = useState("");
  const [proofPreview, setProofPreview] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Clipboard copies
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // V2.0 States
  const [activeTab, setActiveTab] = useState<"billing" | "history">("billing");
  const [dismissedRejected, setDismissedRejected] = useState(false);
  const [detailTx, setDetailTx] = useState<any | null>(null);
  const [expandedTxIds, setExpandedTxIds] = useState<string[]>([]);

  // Free-input items: this participant self-reports their own share of an
  // item the admin has no fixed price for. Keyed by the item's allocation id,
  // so typing here immediately reflects in the effective transaction totals
  // below (Select Individual Transactions / Amount Transferred) even before
  // the declaration is submitted or approved.
  const [freeInputDrafts, setFreeInputDrafts] = useState<Record<string, string>>({});
  const [submittingFreeInput, setSubmittingFreeInput] = useState<string | null>(null);
  // A rejected free-input item shows its old value locked by default; the
  // participant has to explicitly click the edit trigger to unlock it for a
  // resubmission, rather than being dropped straight into an editable field.
  const [freeInputEditing, setFreeInputEditing] = useState<Record<string, boolean>>({});

  const toggleFreeInputEdit = (allocationId: string, prefill?: number) => {
    setFreeInputEditing(prev => ({ ...prev, [allocationId]: !prev[allocationId] }));
    setFreeInputDrafts(prev => (
      prev[allocationId] !== undefined ? prev : { ...prev, [allocationId]: prefill !== undefined ? String(prefill) : "" }
    ));
  };

  const toggleExpandTx = (id: string) => {
    setExpandedTxIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const fetchPortalDetails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/pay-portal/${token}`);
      if (res.ok) {
        const data = await res.json();
        setPortalData(data);

        // Retrieve dismissal status of rejected warning based on submission id
        if (data.recentRejected) {
          const key = `dismissed_rejected_${data.recentRejected.id}`;
          const isDismissed = localStorage.getItem(key) === "true";
          setDismissedRejected(isDismissed);
        }

        // Populate initial payment selector selections (by default select all transactions)
        if (data.payableTransactions) {
          const ids = data.payableTransactions.map((tx: any) => tx.id);
          setSelectedTransactionIds(ids);
          
          // Total due is remaining
          setDeclaredAmount(data.totals.remaining);
        }

        // Fetch public payment methods too
        const resMethods = await fetch("/api/public/payment-methods");
        if (resMethods.ok) {
          const methods = await resMethods.json();
          setPaymentMethods(methods);
          // Left unselected on purpose — the participant must actively pick
          // their transfer method rather than have one pre-chosen for them.
        }
      } else {
        onShowNotification("Token tautan pembayaran personal tidak valid atau telah dicabut.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Error loading payment portal data.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchPortalDetails();
    }
  }, [token]);

  // Marks a free-input item Approved with its declared amount directly in
  // local state — the declaration counts immediately (no admin approval
  // gate), so there's no need to wait on a round-trip refetch for the
  // subtotal / selector / everything else to reflect it.
  const applyFreeInputSubmissionLocally = (allocationId: string, amount: number) => {
    setPortalData((prev: any) => {
      if (!prev) return prev;

      const patchList = (list: any[]) => (list || []).map((tx: any) => {
        let matched = false;
        const assignedItems = (tx.assignedItems || []).map((it: any) => {
          if (it.freeInputAllocationId !== allocationId) return it;
          matched = true;
          return { ...it, freeInputStatus: "Approved", freeInputRejectionReason: undefined, allocatedAmount: amount };
        });
        if (!matched) return { ...tx, assignedItems };
        return {
          ...tx,
          assignedItems,
          allocationTotal: (tx.allocationTotal || 0) + amount,
          obligationAmount: (tx.obligationAmount || 0) + amount,
          remainingAmount: (tx.remainingAmount || 0) + amount,
        };
      });

      return {
        ...prev,
        payableTransactions: patchList(prev.payableTransactions),
        outstandingTransactions: patchList(prev.outstandingTransactions),
        totals: {
          ...prev.totals,
          totalOriginalObligation: (prev.totals?.totalOriginalObligation || 0) + amount,
          remainingPayable: (prev.totals?.remainingPayable || 0) + amount,
          remaining: (prev.totals?.remaining || 0) + amount,
        },
      };
    });
  };

  const handleSubmitFreeInput = async (allocationId: string) => {
    const raw = freeInputDrafts[allocationId];
    const amount = Number(raw);
    if (!raw || isNaN(amount) || amount < 0) {
      onShowNotification("Masukkan nominal yang valid.", "error");
      return;
    }

    setSubmittingFreeInput(allocationId);
    try {
      const res = await fetch(`/api/public/pay-portal/${token}/free-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocationId, amount })
      });

      if (res.ok) {
        onShowNotification("Nominal berhasil ditambahkan ke tagihan kamu.", "success");
        setFreeInputDrafts(prev => {
          const next = { ...prev };
          delete next[allocationId];
          return next;
        });
        setFreeInputEditing(prev => {
          const next = { ...prev };
          delete next[allocationId];
          return next;
        });
        applyFreeInputSubmissionLocally(allocationId, Math.round(amount));
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal mengirim nominal.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat mengirim nominal.", "error");
    } finally {
      setSubmittingFreeInput(null);
    }
  };

  // A free-input item's "amount" is either the confirmed one (once
  // declared — there's no separate approval step), whatever's currently
  // typed but not yet submitted, or — for a rejected item the participant
  // hasn't opened the editor for yet — the old declared amount, which still
  // counts toward the subtotal/transfer total until they actually change it.
  const getItemEffectiveAmount = (it: any): number => {
    if (!it.isFreeInput) return it.allocatedAmount || 0;
    if (it.freeInputStatus === "Approved") return it.allocatedAmount || 0;
    const draftRaw = freeInputDrafts[it.freeInputAllocationId];
    if (draftRaw !== undefined) {
      const draft = Number(draftRaw);
      return isNaN(draft) ? 0 : draft;
    }
    if (it.freeInputStatus === "Rejected") return it.freeInputDeclaredAmount || 0;
    return 0;
  };

  // A transaction's true "amount you owe" — fixed items plus free-input items
  // at whatever stage they're at, live as the participant types.
  const getEffectiveAllocationTotal = (tx: any): number => {
    const itemsSum = (tx.assignedItems || []).reduce((sum: number, it: any) => sum + getItemEffectiveAmount(it), 0);
    return itemsSum + (tx.chargesAllocated || 0);
  };

  // Handle individual transaction checkboxes (Partial Payments selection 11.2)
  const handleToggleTxSelection = (txId: string) => {
    let nextIds = [...selectedTransactionIds];
    if (nextIds.includes(txId)) {
      nextIds = nextIds.filter(id => id !== txId);
      setPayAll(false);
    } else {
      nextIds.push(txId);
    }
    setSelectedTransactionIds(nextIds);
    // declaredAmount recomputes reactively — see the effect below.
  };

  const handleSelectPayAll = () => {
    setPayAll(true);
    if (portalData) {
      const ids = portalData.payableTransactions.map((tx: any) => tx.id);
      setSelectedTransactionIds(ids);
    }
  };

  // Keeps the selected total in sync with any free-input drafts as they're
  // typed, not just when a checkbox is toggled — this is what makes "Select
  // Individual Transactions" and "Amount Transferred" update live.
  useEffect(() => {
    if (!portalData) return;
    const selectedTxData = portalData.payableTransactions.filter((tx: any) => selectedTransactionIds.includes(tx.id));
    const sum = selectedTxData.reduce((acc: number, tx: any) => acc + getEffectiveAllocationTotal(tx), 0);
    setDeclaredAmount(sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTransactionIds, freeInputDrafts, portalData]);

  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const b64 = (reader.result as string).split(",")[1];
      setProofBase64(b64);
      setProofPreview(reader.result as string);
      onShowNotification("Receipt image captured and encoded!", "success");
    };
  };

  const handleSubmitDeclaration = async (e: React.FormEvent) => {
    e.preventDefault();

    // Every free-input item on a transaction being paid must have been
    // explicitly declared first — a participant can't silently skip one and
    // have it just not count. If they genuinely didn't have any of that
    // item, they still have to declare 0.
    for (const txId of selectedTransactionIds) {
      const tx = payableTransactions.find((t: any) => t.id === txId);
      if (!tx) continue;
      const unresolvedItem = (tx.assignedItems || []).find((it: any) =>
        it.isFreeInput && (it.freeInputStatus === "AwaitingInput" || it.freeInputStatus === "Rejected")
      );
      if (unresolvedItem) {
        onShowNotification(
          `Pada transaksi "${tx.title}", item "${unresolvedItem.name}" perlu diisi nominalnya dulu. Kalau memang tidak ada, isi dengan 0.`,
          "error"
        );
        return;
      }
    }

    if (declaredAmount <= 0) {
      onShowNotification("Jumlah yang ditransfer harus diisi dan lebih besar dari nol.", "error");
      return;
    }
    if (!selectedMethodId) {
      onShowNotification("Metode pembayaran belum dipilih. Silakan pilih salah satu metode transfer di atas.", "error");
      return;
    }
    if (portalData?.requireProof && !proofBase64) {
      onShowNotification("Bukti transfer wajib dilampirkan.", "error");
      return;
    }
    if (!termsAccepted) {
      onShowNotification("Anda harus mencentang kotak pernyataan konfirmasi sebelum mengirim.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/pay-portal/${token}/declare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedObligations: selectedTransactionIds,
          submittedAmount: declaredAmount,
          paymentMethodId: selectedMethodId,
          notes,
          proofBase64
        })
      });

      if (res.ok) {
        onShowNotification("Payment transfer declaration submitted to administrator!", "success");
        // Reset declaration form
        setNotes("");
        setProofBase64("");
        setProofPreview("");
        setTermsAccepted(false);
        fetchPortalDetails(); // Reload state (will show as Pending Verification!)
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Submission error.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Server error during submission.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    onShowNotification("Copied account details!", "success");
    setTimeout(() => setCopiedText(null), 2000);
  };

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-500">Retrieving secure payment credentials...</h2>
        <p className="text-xs text-slate-400 mt-1">Direct cryptographic authorization is running.</p>
      </div>
    );
  }

  if (!portalData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <XCircle className="w-16 h-16 text-rose-500 mb-3" />
        <h2 className="text-xl font-bold text-slate-900">Secure link invalid</h2>
        <p className="text-slate-500 text-xs max-w-sm mt-1.5">
          This payment token has been revoked, fully reconciled, or does not exist. Please contact your split administrator to generate a fresh Click-to-Chat reminder.
        </p>
      </div>
    );
  }

  const { participant, category, totals: memberTotals, payableTransactions, activeSubmissions } = portalData;
  const currentParticipantName = participant?.nickname || participant?.fullName || "Anda";
  // payableTransactions can still hold a transaction purely because it has an
  // unresolved (rejected) free-input item to redeclare, even once
  // verifiedPaid has caught up with the server's (necessarily smaller,
  // Approved-only) totalOriginalObligation -- guard against declaring
  // "fully reimbursed" while one of those is still sitting there unresolved.
  const isFullyReimbursed = memberTotals.verifiedPaid >= memberTotals.totalOriginalObligation && memberTotals.totalOriginalObligation > 0 && payableTransactions.length === 0;

  // The server's memberTotals.remaining only counts Approved allocations, so
  // a rejected free-input item's old (still-owed) amount drops out of it the
  // moment it's rejected -- live-recompute from the same effective-amount
  // logic the itemized cards and "Pay All" button already use, so every
  // total on this page agrees with what the participant sees per item.
  const effectiveRemainingTotal = payableTransactions.reduce((sum: number, tx: any) => sum + getEffectiveAllocationTotal(tx), 0);

  // Find currently selected method object
  const selectedMethod = paymentMethods.find(m => m.id === selectedMethodId);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-12 flex flex-col items-center">
      
      {/* Mobile container wrapper (Spec calls for <= 480px optimized) */}
      <div className="w-full max-w-md bg-white border-x border-slate-200/80 shadow-md min-h-screen flex flex-col text-left">
        
        {/* Secure Authorization Banner */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            <span className="text-[10px] font-mono font-bold tracking-widest uppercase">SECURE BILLING DELEGATE</span>
          </div>
          <span className="text-[9px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-mono">ACTIVE AUTH</span>
        </div>

        {/* Portal Header */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/40">
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">PARTICIPANT INVOICE PORTAL</span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{participant.fullName}</h1>
        </div>

        {/* Status Indicators (Section 11.4) */}
        <div className="px-6 py-4 border-b border-slate-100 bg-white">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">Reimbursement Status</span>
          
          {isFullyReimbursed ? (
            <div className="p-4 bg-emerald-50 border border-emerald-150 rounded-xl flex items-start gap-3 text-emerald-800">
              <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">Fully Reimbursed</span>
                <span className="text-xs text-emerald-700 block mt-0.5">Thank you! Your split obligations for this project are 100% verified and cleared.</span>
              </div>
            </div>
          ) : activeSubmissions.length > 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-150 rounded-xl flex items-start gap-3 text-amber-800">
              <Clock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">Verification Pending</span>
                <span className="text-xs text-amber-700 block mt-0.5">
                  You have {activeSubmissions.length} declaration(s) submitted for verification. The administrator will review your transfer soon.
                </span>
              </div>
            </div>
          ) : payableTransactions.length === 0 ? (
            <div className="p-4 bg-slate-100 border border-slate-200 rounded-xl flex items-start gap-3 text-slate-700">
              <CheckCircle className="w-6 h-6 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">No Outstanding Debts</span>
                <span className="text-xs text-slate-500 block mt-0.5">You don't have any items allocated in this project yet!</span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-rose-50 border border-rose-150 rounded-xl flex items-start gap-3 text-rose-800">
              <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">Payments Due</span>
                <span className="text-xs text-rose-700 block mt-0.5">
                  You have an outstanding balance of <span className="font-bold text-rose-900">{formatIDR(effectiveRemainingTotal)}</span>. Please complete transfers.
                </span>
              </div>
            </div>
          )}

          {/* If there's a rejected submission, show why (AC-017) */}
          {portalData.recentRejected && !dismissedRejected && (
            <div className="p-3.5 bg-rose-100 border border-rose-200 text-rose-800 rounded-xl text-xs mt-3 flex justify-between items-start gap-2">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 animate-bounce" />
                <div>
                  <span className="font-bold block text-rose-900 mb-0.5">Previous Declaration Rejected</span>
                  Rejection reason: <b>"{portalData.recentRejected.rejectionReason}"</b>. Please submit a new declaration with updated receipt proof.
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setDismissedRejected(true);
                  if (portalData?.recentRejected?.id) {
                    localStorage.setItem(`dismissed_rejected_${portalData.recentRejected.id}`, "true");
                  }
                }}
                className="text-rose-500 hover:text-rose-800 p-0.5 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Tabs for Active Billing and Payment History */}
        <div className="grid grid-cols-2 border-b border-slate-100 font-mono text-[10px] font-bold tracking-widest uppercase bg-slate-50/50">
          <button
            type="button"
            onClick={() => setActiveTab("billing")}
            className={`py-3.5 text-center border-b-2 transition-all cursor-pointer ${
              activeTab === "billing" 
                ? "border-indigo-600 text-indigo-600 bg-white" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Active Billing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`py-3.5 text-center border-b-2 transition-all cursor-pointer ${
              activeTab === "history" 
                ? "border-indigo-600 text-indigo-600 bg-white" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Payment History ({portalData.paymentHistory ? portalData.paymentHistory.length : 0})
          </button>
        </div>

        {/* Active Billing Tab View */}
        {activeTab === "billing" && (
          <>
            {/* Breakdown of original individual item consumption (Section 11.3) */}
            {!isFullyReimbursed && payableTransactions.length > 0 && (
              <div className="p-6 border-b border-slate-100 bg-slate-50/10">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Itemized Billing Allocations</h3>
                
                <div className="space-y-2.5">
                  {payableTransactions.map((tx: any) => {
                    const isExpanded = expandedTxIds.includes(tx.id);
                    return (
                      <div key={tx.id} className="bg-white border border-slate-200/70 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
                        {/* Main Summary Row (always visible) */}
                        <div 
                          onClick={() => toggleExpandTx(tx.id)}
                          className="p-3.5 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-slate-50/40 transition-colors"
                        >
                          {/* Left: Nama Transaksi (hitam bold) & Merchant / Tempat (warna abu) */}
                          <div className="flex-1 min-w-0">
                            <span className="font-bold text-slate-900 text-sm block truncate">
                              {tx.title || tx.merchant || "Transaksi"}
                            </span>
                            <span className="text-xs text-slate-500 block mt-0.5 truncate">
                              {tx.merchant && tx.merchant !== tx.title ? tx.merchant : (tx.categoryName ? `Kategori: ${tx.categoryName}` : "")}
                            </span>
                          </div>

                          {/* Right: Total per User & Toggle Button */}
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-bold text-indigo-700 font-mono text-sm">
                              {formatIDR(getEffectiveAllocationTotal(tx))}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandTx(tx.id);
                              }}
                              className={`px-2.5 py-1.5 rounded-lg border transition-all flex items-center justify-center cursor-pointer text-xs font-medium gap-1 ${
                                isExpanded 
                                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" 
                                  : "bg-slate-50 border-slate-200/50 text-indigo-600 hover:bg-slate-100 hover:text-indigo-800"
                              }`}
                              title={isExpanded ? "Tutup Rincian" : "Lihat Detail Rincian"}
                            >
                              <span className="text-[10px] text-slate-400 font-sans hidden sm:inline">
                                {isExpanded ? "Tutup" : "Rincian"}
                              </span>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Collapsible Detail Section */}
                        {isExpanded && (
                          <div className="border-t border-slate-100 bg-slate-50/30 p-4 space-y-3.5 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
                            {/* Detail metadata: Kategori, Tanggal, Total Harga Asli */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 font-mono text-[11px] bg-white border border-slate-100 p-3 rounded-lg shadow-sm">
                              {tx.categoryName && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Kategori:</span>
                                  <span className="font-semibold text-slate-800">{tx.categoryName}</span>
                                </div>
                              )}
                              {tx.date && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Tanggal:</span>
                                  <span className="font-semibold text-slate-700">
                                    {new Date(tx.date).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                                  </span>
                                </div>
                              )}
                              {tx.transactionTotal !== undefined && (
                                <div className="flex justify-between sm:col-span-2 pt-1 border-t border-slate-50">
                                  <span className="text-slate-400">Harga Asli:</span>
                                  <span className="font-bold text-slate-800">{formatIDR(tx.transactionTotal)}</span>
                                </div>
                              )}
                            </div>

                            {/* Itemized list details */}
                            {tx.assignedItems && tx.assignedItems.length > 0 && (
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider block">Rincian Konsumsi Item:</span>
                                <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-xs space-y-3">
                                  {tx.assignedItems.map((it: any, idx: number) => {
                                    const { namesString: itemNames, count: itemCount } = getItemParticipantInfo(it, currentParticipantName);
                                    const lineTotalCalc = it.lineTotal || (it.quantity * it.unitPrice);

                                    if (it.isFreeInput) {
                                      const isEditingRejected = it.freeInputStatus === "Rejected" && !!freeInputEditing[it.freeInputAllocationId];
                                      return (
                                        <div key={it.id || idx} className="pb-2.5 border-b border-slate-100 last:border-b-0 last:pb-0">
                                          <div className="flex justify-between items-start gap-2">
                                            <div className="flex-1 min-w-0">
                                              <div className="font-bold text-slate-800 text-xs sm:text-sm">
                                                {it.name}
                                              </div>
                                              <div className="text-amber-600 font-mono text-[11px] font-normal mt-0.5">
                                                Nominal ditentukan sendiri oleh peserta
                                              </div>
                                            </div>
                                            {it.freeInputStatus === "Approved" && (
                                              <div className="font-bold text-slate-800 font-mono text-xs sm:text-sm shrink-0 pt-0.5">
                                                {formatIDR(it.allocatedAmount)}
                                              </div>
                                            )}
                                            {it.freeInputStatus === "Rejected" && !isEditingRejected && (
                                              <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                                <span className="font-bold text-slate-800 font-mono text-xs sm:text-sm">
                                                  {formatIDR(it.freeInputDeclaredAmount || 0)}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleFreeInputEdit(it.freeInputAllocationId, it.freeInputDeclaredAmount);
                                                  }}
                                                  title="Klik untuk mengisi ulang nominal"
                                                  className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-md cursor-pointer"
                                                >
                                                  <Pencil className="w-3 h-3" />
                                                </button>
                                              </div>
                                            )}
                                          </div>

                                          {(it.freeInputStatus === "AwaitingInput" || isEditingRejected) && (
                                            <div className="mt-1.5 space-y-1.5">
                                              <div className="flex items-center gap-2">
                                                <div className="relative flex-1">
                                                  <span className="absolute left-2.5 top-1.5 text-[10px] font-bold text-slate-400">IDR</span>
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    placeholder="Nominal kamu"
                                                    value={freeInputDrafts[it.freeInputAllocationId] ?? ""}
                                                    onChange={(e) => setFreeInputDrafts(prev => ({ ...prev, [it.freeInputAllocationId]: e.target.value }))}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 font-mono font-bold text-[11px] focus:outline-none focus:border-indigo-600 focus:bg-white text-slate-800"
                                                  />
                                                </div>
                                                <button
                                                  type="button"
                                                  disabled={submittingFreeInput === it.freeInputAllocationId}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSubmitFreeInput(it.freeInputAllocationId);
                                                  }}
                                                  className="shrink-0 px-3 py-1.5 bg-slate-950 hover:bg-slate-900 text-white font-semibold text-[11px] rounded-lg cursor-pointer disabled:opacity-50"
                                                >
                                                  {submittingFreeInput === it.freeInputAllocationId ? <RefreshCw className="w-3 h-3 animate-spin" /> : (it.freeInputStatus === "Rejected" ? "Kirim Ulang" : "Kirim")}
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={it.id || idx} className="pb-2.5 border-b border-slate-100 last:border-b-0 last:pb-0">
                                        <div className="flex justify-between items-start gap-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-800 text-xs sm:text-sm">
                                              {it.name}
                                            </div>
                                            <div className="text-slate-400 font-mono text-[11px] font-normal mt-0.5">
                                              ({it.quantity}x @ {formatIDR(it.unitPrice)} = {formatIDR(lineTotalCalc)})
                                            </div>
                                            <div className="text-[11px] text-slate-400 font-sans mt-1">
                                              Dibagi oleh{itemCount > 0 ? ` (${itemCount} orang)` : ""}: <span className="text-slate-600 font-medium">{itemNames}</span>
                                            </div>
                                          </div>
                                          <div className="font-bold text-slate-800 font-mono text-xs sm:text-sm shrink-0 pt-0.5">
                                            {formatIDR(it.allocatedAmount)}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}

                                  <div className="border-t border-slate-200/80 pt-2.5 flex justify-between items-center text-[11px] sm:text-xs">
                                    <span className="text-slate-500 font-medium">Subtotal Jumlah Item:</span>
                                    <span className="font-bold text-slate-800 font-mono">
                                      {formatIDR(tx.assignedItems.reduce((sum: number, it: any) => sum + getItemEffectiveAmount(it), 0))}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Taxes & fees */}
                            {tx.chargesAllocated > 0 && (
                              <div className="bg-amber-50/40 border border-amber-100/50 rounded-xl p-3 flex justify-between items-center text-xs text-amber-800 font-medium italic">
                                <span>Pajak & Layanan Proporsional:</span>
                                <span className="font-mono font-bold">+{formatIDR(tx.chargesAllocated)}</span>
                              </div>
                            )}

                            {/* Final Allocation Subtotal inside the expanded card */}
                            <div className="pt-3 border-t border-slate-150 flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-800">Alokasi Anda (Subtotal):</span>
                              <span className="text-sm font-bold text-indigo-700 font-mono">{formatIDR(getEffectiveAllocationTotal(tx))}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Financial math summary (Origin Obligation and Verified Reimbursed Paid have been removed for summary compactness) */}
                <div className="mt-6 pt-5 border-t border-slate-200 text-xs text-slate-500">
                  <div className="flex justify-between text-sm text-slate-800 font-bold pt-1">
                    <span>Total Due Balance:</span>
                    <span className="font-mono text-base text-indigo-700">{formatIDR(effectiveRemainingTotal)}</span>
                  </div>
                </div>
              </div>
            )}

        {/* Interactive Payment Selector (Section 11.2 - Partial Payments) */}
        {!isFullyReimbursed && payableTransactions.length > 1 && (
          <div className="p-6 border-b border-slate-100 bg-white">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Flexible Payment Selector</h3>
            
            <div className="space-y-2.5">
              <button 
                type="button"
                onClick={handleSelectPayAll}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  payAll 
                    ? "border-indigo-600 bg-indigo-50/20" 
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  {payAll ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                  <span className="font-semibold text-slate-800">Pay All Outstanding Balance</span>
                </div>
                <span className="text-xs font-bold text-slate-950 font-mono">
                  {formatIDR(payableTransactions.reduce((sum: number, tx: any) => sum + getEffectiveAllocationTotal(tx), 0))}
                </span>
              </button>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2 text-xs text-slate-600">
                <span className="text-[10px] font-bold text-slate-400 uppercase block tracking-wider">Select individual transactions (Partial)</span>
                {payableTransactions.map((tx: any) => {
                  const isChecked = selectedTransactionIds.includes(tx.id);
                  return (
                    <label key={tx.id} className="flex items-center justify-between p-2 bg-white rounded border border-slate-100 cursor-pointer hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTxSelection(tx.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium truncate max-w-[180px]">{tx.title}</span>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-slate-700">{formatIDR(getEffectiveAllocationTotal(tx))}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Configured Admin Payment Instructions & QRIS Viewer */}
        {!isFullyReimbursed && payableTransactions.length > 0 && (
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Administrator Payment Destinations</h3>
            <p className="text-[10px] text-slate-400 mb-3 font-sans leading-relaxed">
              Silakan pilih salah satu metode pembayaran di bawah ini dengan menekan kartu pembayaran tersebut, lalu transfer sesuai rincian yang tertera.
            </p>
            
            {paymentMethods.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No instructions provided. Please ask admin to add a bank node.</p>
            ) : (
              <div className="space-y-3.5">
                {paymentMethods.map(m => {
                  const isSelected = selectedMethodId === m.id;
                  const isQRIS = m.type === "QRIS" || m.type === "qris";
                  const isBank = m.type === "Bank Account" || m.type === "bank" || m.type === "Bank";
                  const isWallet = m.type === "E-Wallet" || m.type === "wallet" || m.type === "E-wallet";

                  return (
                    <div 
                      key={m.id}
                      onClick={() => setSelectedMethodId(m.id)}
                      className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                        isSelected 
                          ? "bg-indigo-50/30 border-indigo-600 shadow-md ring-2 ring-indigo-600/10" 
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div>
                        {/* Header Row */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            {/* Selection indicator */}
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all ${
                              isSelected ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>

                            {isBank && <Landmark className="w-4 h-4 text-indigo-600" />}
                            {isWallet && <Smartphone className="w-4 h-4 text-teal-600" />}
                            {isQRIS && <QrCode className="w-4 h-4 text-amber-600" />}
                            {!isBank && !isWallet && !isQRIS && <Landmark className="w-4 h-4 text-slate-500" />}
                            
                            <span className="font-bold text-xs text-slate-800">{m.name}</span>
                          </div>

                          {m.isPreferred && (
                            <span className="bg-indigo-50 text-indigo-600 border border-indigo-150 text-[8px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                              Preferred
                            </span>
                          )}
                        </div>

                        {/* Details content */}
                        {!isQRIS ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-100 rounded-lg">
                              <div>
                                <span className="text-[8px] text-slate-400 block uppercase font-mono font-bold">Account Number:</span>
                                <span className="font-mono font-bold text-xs text-slate-800">{m.accountNumber}</span>
                              </div>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(m.accountNumber);
                                }}
                                className="p-1.5 rounded-md hover:bg-slate-200/80 border border-slate-150 text-slate-600 cursor-pointer transition-colors"
                                title="Copy Account Number"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="flex justify-between items-center text-xs text-slate-500 font-sans px-0.5">
                              <span>Account Holder:</span>
                              <span className="font-semibold text-slate-800">{m.accountName || m.accountHolder}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-3 bg-slate-50 border border-slate-150 rounded-lg">
                            {m.qrisImage || m.imageUrl ? (
                              <img 
                                src={m.qrisImage || m.imageUrl} 
                                alt="Static QRIS Code" 
                                className="w-36 h-36 object-contain bg-white border border-slate-200 p-1 rounded shadow-sm"
                              />
                            ) : (
                              <QrCode className="w-10 h-10 text-slate-300" />
                            )}
                            <span className="text-[8px] font-mono font-bold text-slate-400 mt-1.5">INDONESIAN QRIS INTERCHANGE STANDARDS</span>
                          </div>
                        )}
                      </div>

                      {m.instructions && (
                        <p className="mt-2.5 p-2 bg-slate-50 border border-slate-100 rounded text-[10px] text-slate-400 italic font-sans leading-relaxed">
                          Memo: "{m.instructions}"
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Transfer Declaration Form Submission (Section 11.5) */}
        {!isFullyReimbursed && payableTransactions.length > 0 && (
          <div className="p-6 bg-white flex-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Submit Transfer Declaration</h3>
            
            <form onSubmit={handleSubmitDeclaration} noValidate className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Amount Transferred (IDR) *</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 font-bold text-slate-400">IDR</span>
                  <input 
                    type="number"
                    required
                    placeholder="Enter amount matching transfer slip..."
                    value={declaredAmount || ""}
                    onChange={(e) => setDeclaredAmount(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-12 pr-4 py-2.5 font-mono font-bold text-sm focus:outline-none focus:border-indigo-600 focus:bg-white text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes (Optional)</label>
                <input 
                  type="text"
                  placeholder="e.g. Sent from BCA Bank to Yeb BCA Account..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs focus:outline-none"
                />
              </div>

              {/* Upload payment proof receipt (PPL-004) */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Attach Transfer Receipt Proof {portalData?.requireProof ? "(Wajib)" : "(Optional)"}
                </label>
                <label className="flex flex-col items-center justify-center p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50 cursor-pointer hover:bg-slate-100/40">
                  <FileUp className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="font-semibold text-slate-600">Upload Receipt Graphic</span>
                  <input
                    type="file"
                    accept="image/*"
                    required={portalData?.requireProof}
                    onChange={handleProofUpload}
                    className="hidden"
                  />
                </label>
                {proofPreview && (
                  <div className="text-center mt-3">
                    <img src={proofPreview} alt="Transfer Slip Preview" className="w-24 h-24 mx-auto object-contain bg-white border rounded p-1" />
                    <span className="text-[10px] text-emerald-600 font-mono font-bold mt-1 block">✓ Receipt Image Prepared</span>
                  </div>
                )}
              </div>

              {/* Mandatory Legal declaration terms (PPL-005) */}
              <label className="flex items-start gap-2.5 p-3.5 bg-slate-50 border border-slate-150 rounded-xl cursor-pointer">
                <input 
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5 shrink-0"
                />
                <span className="text-[10.5px] text-slate-500 leading-relaxed font-serif">
                  Saya menyatakan bahwa saya sudah transfer sesuai dengan transaksi sebenarnya dan nominalnya sama persis, sehingga yudhis dapat percaya dengan saya bahwa saya benar benar sudah transfer.
                </span>
              </label>

              <button 
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:bg-slate-350 transition-colors"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Declare Split Reimbursement
                  </>
                )}
              </button>
            </form>
          </div>
        )}
          </>
        )}

        {/* Payment History Tab View */}
        {activeTab === "history" && (
          <div className="p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Previous Payment History</h3>
            {(!portalData.paymentHistory || portalData.paymentHistory.filter((h: any) => h.status === "Paid").length === 0) ? (
              <p className="text-xs text-slate-400 italic">No fully verified paid payment history found.</p>
            ) : (
              <div className="space-y-4">
                {portalData.paymentHistory
                  .filter((h: any) => h.status === "Paid")
                  .map((h: any) => {
                    return (
                      <div key={h.id} className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/10 text-xs space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono text-[10px] text-emerald-600 block font-bold">
                              VERIFIED PAID DATE: {h.dates?.verificationDate ? new Date(h.dates.verificationDate).toLocaleDateString("id-ID", { dateStyle: "medium" }) : new Date(h.createdAt || h.dates?.declarationDate).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                            </span>
                            <span className="font-bold text-slate-900 font-mono text-base mt-0.5 block">{formatIDR(h.submittedAmount)}</span>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider font-bold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                            PAID
                          </span>
                        </div>
                        
                        {h.notes && (
                          <p className="text-slate-500 italic">Notes: "{h.notes}"</p>
                        )}

                        {/* Display highly enriched transaction allocations details */}
                        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-slate-150/60 text-[11px] text-slate-500">
                          {h.methodSnapshot && (
                            <div className="flex justify-between font-mono text-[10px]">
                              <span>Destination Method:</span>
                              <span className="font-semibold text-slate-700">{h.methodSnapshot.name} ({h.methodSnapshot.type === "bank" ? "Bank" : h.methodSnapshot.type})</span>
                            </div>
                          )}
                          {h.referenceNumber && (
                            <div className="flex justify-between font-mono text-[10px]">
                              <span>Ref Number:</span>
                              <span className="text-slate-600 font-bold">{h.referenceNumber}</span>
                            </div>
                          )}

                          {h.resolvedObligations && h.resolvedObligations.length > 0 && (
                            <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Allocated Billings Included:</span>
                              <div className="space-y-2">
                                {h.resolvedObligations.map((obl: any, oIdx: number) => {
                                  const collapseKey = `${h.id}-${obl.transactionId || oIdx}`;
                                  const isExpanded = expandedTxIds.includes(collapseKey);
                                  return (
                                    <div key={oIdx} className="bg-white border border-slate-150 rounded-xl overflow-hidden shadow-sm transition-all duration-200">
                                      {/* Header row */}
                                      <div 
                                        onClick={() => toggleExpandTx(collapseKey)}
                                        className="flex items-center justify-between gap-4 p-3 cursor-pointer select-none hover:bg-slate-50/50 transition-colors"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <span className="font-bold text-slate-800 text-xs block truncate">
                                            {obl.title || obl.merchant || "Transaksi"}
                                          </span>
                                          <span className="text-[10px] text-slate-500 block mt-0.5 truncate">
                                            {obl.merchant && obl.merchant !== obl.title ? obl.merchant : (obl.categoryName ? `Kategori: ${obl.categoryName}` : "")}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2.5 shrink-0">
                                          <span className="font-bold text-emerald-700 font-mono text-xs">
                                            {formatIDR(obl.allocationTotal)}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleExpandTx(collapseKey);
                                            }}
                                            className={`p-1 rounded-md border transition-colors flex items-center justify-center cursor-pointer ${
                                              isExpanded 
                                                ? "bg-indigo-50 border-indigo-150 text-indigo-700" 
                                                : "bg-slate-50 border-slate-150/50 text-indigo-600 hover:bg-slate-100"
                                            }`}
                                            title={isExpanded ? "Tutup Rincian" : "Lihat Detail Rincian"}
                                          >
                                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                          </button>
                                        </div>
                                      </div>

                                      {/* Collapsed Detail content */}
                                      {isExpanded && (
                                        <div className="border-t border-slate-100 bg-slate-50/30 p-3.5 space-y-3 text-[11px] animate-in fade-in slide-in-from-top-1 duration-150">
                                          {/* Metadata details */}
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-600 font-mono text-[10px] bg-white border border-slate-100 p-2.5 rounded-lg shadow-sm">
                                            {obl.categoryName && (
                                              <div className="flex justify-between">
                                                <span className="text-slate-400">Kategori:</span>
                                                <span className="font-semibold text-slate-800">{obl.categoryName}</span>
                                              </div>
                                            )}
                                            {obl.date && (
                                              <div className="flex justify-between">
                                                <span className="text-slate-400">Tanggal:</span>
                                                <span className="font-semibold text-slate-700">
                                                  {new Date(obl.date).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                                                </span>
                                              </div>
                                            )}
                                            {obl.transactionTotal !== undefined && (
                                              <div className="flex justify-between sm:col-span-2 pt-1 border-t border-slate-50">
                                                <span className="text-slate-400">Harga Asli:</span>
                                                <span className="font-bold text-slate-800">{formatIDR(obl.transactionTotal)}</span>
                                              </div>
                                            )}
                                          </div>

                                          {/* Item list */}
                                          {obl.assignedItems && obl.assignedItems.length > 0 && (
                                            <div className="space-y-1">
                                              <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-wider block">Rincian Konsumsi Item:</span>
                                              <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-sm text-[11px] space-y-2">
                                                {obl.assignedItems.map((item: any, idx: number) => {
                                                  const { namesString: itemNames, count: itemCount } = getItemParticipantInfo(item, currentParticipantName);
                                                  const lineTotalCalc = item.lineTotal || (item.quantity * item.unitPrice);
                                                  return (
                                                    <div key={item.id || idx} className="pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                                                      <div className="flex justify-between items-start gap-2">
                                                        <div className="flex-1 min-w-0">
                                                          <div className="font-bold text-slate-800">
                                                            {item.name}
                                                          </div>
                                                          <div className="text-slate-400 font-mono text-[10px] font-normal mt-0.5">
                                                            ({item.quantity}x @ {formatIDR(item.unitPrice)} = {formatIDR(lineTotalCalc)})
                                                          </div>
                                                          <div className="text-[10px] text-slate-400 font-sans mt-1">
                                                            Dibagi oleh{itemCount > 0 ? ` (${itemCount} orang)` : ""}: <span className="text-slate-600 font-medium">{itemNames}</span>
                                                          </div>
                                                        </div>
                                                        <div className="font-bold text-slate-800 font-mono text-[11px] shrink-0 pt-0.5">
                                                          {formatIDR(item.allocatedAmount)}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  );
                                                })}

                                                <div className="border-t border-slate-100 pt-1.5 flex justify-between items-center text-[10px]">
                                                  <span className="text-slate-500 font-mono">Subtotal Jumlah Item:</span>
                                                  <span className="font-bold text-slate-800 font-mono">
                                                    {formatIDR(obl.assignedItems.reduce((sum: number, item: any) => sum + (item.allocatedAmount || 0), 0))}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          )}

                                          {/* Taxes/charges */}
                                          {obl.chargesAllocated > 0 && (
                                            <div className="bg-amber-50/30 border border-amber-100/50 rounded-lg p-2.5 flex justify-between items-center text-[11px] text-amber-800 font-medium italic">
                                              <span>Pajak & Layanan Proporsional:</span>
                                              <span className="font-mono font-bold">+{formatIDR(obl.chargesAllocated)}</span>
                                            </div>
                                          )}

                                          {/* Subtotal */}
                                          <div className="pt-2 border-t border-slate-150 flex justify-between items-center">
                                            <span className="text-[11px] font-bold text-slate-800">Alokasi Anda:</span>
                                            <span className="text-xs font-bold text-indigo-700 font-mono">{formatIDR(obl.allocationTotal)}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Footer info branding */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 text-center text-[10px] text-slate-400 font-mono space-y-1 mt-auto">
          <p>© 2026 Smart Split Bill Engine</p>
          <p>Yeb's Authorized Node & Verified Portal Token Client</p>
        </div>

        {/* Detail Modal Popup for Transaction Details */}
        {detailTx && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
              {/* Header */}
              <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div className="min-w-0 pr-4">
                  <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Rincian Lengkap Transaksi</span>
                  <h4 className="text-sm font-bold text-slate-900 mt-1 break-words">{detailTx.title}</h4>
                </div>
                <button 
                  onClick={() => setDetailTx(null)}
                  className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* Info Grid */}
                <div className="grid grid-cols-1 gap-2.5 border-b border-slate-100 pb-4 font-mono text-[11px]">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-400">Merchant:</span>
                    <span className="font-bold text-slate-800 text-right truncate max-w-[200px]">{detailTx.merchant || detailTx.title || "Tanpa Merchant"}</span>
                  </div>
                  {detailTx.categoryName && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-400">Kategori:</span>
                      <span className="font-semibold text-slate-700 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px]">{detailTx.categoryName}</span>
                    </div>
                  )}
                  {detailTx.date && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-400">Tanggal:</span>
                      <span className="font-semibold text-slate-700">
                        {new Date(detailTx.date).toLocaleDateString("id-ID", { dateStyle: "long" })}
                      </span>
                    </div>
                  )}
                  {detailTx.transactionTotal !== undefined && (
                    <div className="flex justify-between items-center gap-2 pt-1 border-t border-slate-100/60">
                      <span className="text-slate-400">Total Harga Asli:</span>
                      <span className="font-bold text-slate-800">{formatIDR(detailTx.transactionTotal)}</span>
                    </div>
                  )}
                </div>

                {/* Itemized Allocations */}
                {detailTx.assignedItems && detailTx.assignedItems.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider block">Rincian Konsumsi Item:</span>
                    <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm text-xs space-y-2.5">
                      {detailTx.assignedItems.map((it: any, idx: number) => {
                        const { namesString: itemNames, count: itemCount } = getItemParticipantInfo(it, currentParticipantName);
                        const lineTotalCalc = it.lineTotal || (it.quantity * it.unitPrice);
                        return (
                          <div key={it.id || idx} className="pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-bold text-slate-800 text-xs">
                                  {it.name}
                                </div>
                                <div className="text-slate-400 font-mono text-[10px] font-normal mt-0.5">
                                  ({it.quantity}x @ {formatIDR(it.unitPrice)} = {formatIDR(lineTotalCalc)})
                                </div>
                                <div className="text-[10px] text-slate-400 font-sans mt-1">
                                  Dibagi oleh{itemCount > 0 ? ` (${itemCount} orang)` : ""}: <span className="text-slate-600 font-medium">{itemNames}</span>
                                </div>
                              </div>
                              <div className="font-bold text-slate-800 font-mono text-xs shrink-0 pt-0.5">
                                {formatIDR(it.allocatedAmount)}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <div className="border-t border-slate-100 pt-2 flex justify-between items-center text-[11px]">
                        <span className="text-slate-500 font-mono">Subtotal Jumlah Item:</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {formatIDR(detailTx.assignedItems.reduce((sum: number, it: any) => sum + (it.allocatedAmount || 0), 0))}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Proportion Charges / Taxes */}
                {detailTx.chargesAllocated > 0 && (
                  <div className="bg-amber-50/40 border border-amber-100/70 rounded-xl p-3 flex justify-between items-center text-xs text-amber-800 font-medium italic">
                    <span>Pajak & Layanan Proporsional:</span>
                    <span className="font-mono font-bold">+{formatIDR(detailTx.chargesAllocated)}</span>
                  </div>
                )}

                {/* Final Allocation */}
                <div className="pt-3.5 border-t border-slate-150 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-800">Alokasi Anda (Subtotal):</span>
                  <span className="text-base font-bold text-indigo-700 font-mono">{formatIDR(detailTx.allocationTotal)}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDetailTx(null)}
                  className="px-5 py-2 bg-slate-950 hover:bg-slate-900 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer"
                >
                  Tutup Rincian
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
