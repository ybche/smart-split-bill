import React, { useState, useEffect } from "react";
import {
  Check, X, Eye, EyeOff, RefreshCw, Info, Calendar, DollarSign,
  User, CheckCircle, AlertTriangle, MessageSquare, Clipboard, ExternalLink, ShieldAlert,
  Trash2, Search, ArrowUpDown, ChevronLeft, ChevronRight, Download, Pencil
} from "lucide-react";
import { PaymentSubmission } from "../types";

interface PaymentsProps {
  token: string;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Payments({ token, onShowNotification }: PaymentsProps) {
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Dual tab state
  const [activeTab, setActiveTab] = useState<"overview" | "personal">("overview");
  const [personalOverview, setPersonalOverview] = useState<any[]>([]);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("all");
  const [personalSearch, setPersonalSearch] = useState("");
  const [personalStatusFilter, setPersonalStatusFilter] = useState("all");

  // Proof Lightbox State
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Reject / Reason Modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Edit Submission Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSubId, setEditSubId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");

  // Method Snapshot modal states
  const [selectedSnapshot, setSelectedSnapshot] = useState<any | null>(null);
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [snapshotStatus, setSnapshotStatus] = useState("all");
  const [snapshotSortBy, setSnapshotSortBy] = useState<"name" | "amount" | "date">("name");
  const [snapshotSortOrder, setSnapshotSortOrder] = useState<"asc" | "desc">("asc");
  const [snapshotPage, setSnapshotPage] = useState(1);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPayments(data);
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil data pengajuan pembayaran.", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchPersonalOverview = async () => {
    setPersonalLoading(true);
    try {
      const res = await fetch("/api/payments/personal-overview", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPersonalOverview(data);
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil riwayat peserta.", "error");
    } finally {
      setPersonalLoading(false);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const res = await fetch("/api/payment-methods", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPaymentMethods(data);
      }
    } catch (err) {
      console.error("Failed to fetch payment methods", err);
    }
  };

  useEffect(() => {
    fetchPayments();
    fetchPersonalOverview();
    fetchPaymentMethods();
  }, []);

  const handleVerifyPayment = async (id: string, action: "approve" | "reject", reason?: string) => {
    try {
      const res = await fetch(`/api/payments/${id}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ action, rejectionReason: reason })
      });

      if (res.ok) {
        onShowNotification(action === "approve" ? "Payment verified & allocated!" : "Payment submission rejected.", "success");
        setShowRejectModal(false);
        setRejectionReason("");
        setSelectedSubId(null);
        fetchPayments();
        fetchPersonalOverview();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal melakukan verifikasi pembayaran.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openRejectModal = (id: string) => {
    setSelectedSubId(id);
    setRejectionReason("");
    setShowRejectModal(true);
  };

  const openEditModal = (h: any) => {
    setEditSubId(h.submissionId);
    setEditAmount(String(h.submittedAmount === "Not Paid" ? 0 : h.submittedAmount));
    setShowEditModal(true);
  };

  const handleEditPayment = async () => {
    if (!editSubId) return;
    const amountNum = Number(editAmount);
    if (editAmount === "" || isNaN(amountNum) || amountNum < 0) {
      onShowNotification("Please enter a valid submitted amount.", "error");
      return;
    }

    try {
      const res = await fetch(`/api/payments/${editSubId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ submittedAmount: amountNum })
      });

      if (res.ok) {
        onShowNotification("Payment submission updated successfully.", "success");
        setShowEditModal(false);
        setEditSubId(null);
        fetchPayments();
        fetchPersonalOverview();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal memperbarui pengajuan pembayaran.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat memperbarui pembayaran.", "error");
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this payment submission? All allocated balance amounts will be revoked and recalculated.")) {
      return;
    }

    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Payment record deleted and balances recalculated successfully.", "success");
        fetchPayments();
        fetchPersonalOverview();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menghapus pembayaran.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat menghapus pembayaran.", "error");
    }
  };

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredPayments = payments.filter(p => {
    if (filterStatus === "all") return true;
    return p.status === filterStatus;
  });

  const getMethodTotal = (methodName: string, accountNum: string) => {
    return payments
      .filter(p => p.status === "Paid" && p.methodSnapshot?.name === methodName && p.methodSnapshot?.accountNumber === accountNum)
      .reduce((sum, p) => sum + p.submittedAmount, 0);
  };

  const handleDownloadAllPaymentsCSV = () => {
    if (!payments || payments.length === 0) {
      onShowNotification("No transaction data available to export.", "info");
      return;
    }

    const csvRows = [
      [
        "Submission ID",
        "Participant Name",
        "Category Name",
        "Date Declared",
        "Target Channel Method",
        "Expected Amount",
        "Submitted Amount",
        "Status",
        "Rejection Reason",
        "Notes"
      ],
      ...payments.map(p => {
        const methodStr = p.methodSnapshot 
          ? `${p.methodSnapshot.name} - ${p.methodSnapshot.accountNumber} (${p.methodSnapshot.accountHolder || "Admin"})`
          : "—";
        return [
          p.id,
          p.participantName,
          p.categoryName,
          p.createdAt ? new Date(p.createdAt).toISOString() : (p.dates?.declarationDate ? new Date(p.dates.declarationDate).toISOString() : "—"),
          methodStr,
          p.expectedAmount || 0,
          p.submittedAmount || 0,
          p.status,
          p.rejectionReason || "",
          p.notes || ""
        ];
      })
    ];

    const csvContent = "data:text/csv;charset=utf-8," 
      + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `all_payments_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowNotification("All payments exported successfully to CSV.", "success");
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Declaration review center</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Payments_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Review participant submitted transfer receipts, check bank account references, and approve or reject balance reconciliations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={handleDownloadAllPaymentsCSV}
            className="flex items-center gap-1.5 border border-white/15 bg-white/[0.02] hover:bg-white/[0.06] text-white px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer"
            title="Download CSV for All Payment Submissions"
          >
            <Download className="w-3.5 h-3.5 text-blue-500" />
            Download CSV (All Transactions)
          </button>

          {/* Tab Selection buttons */}
          <div className="flex bg-white/[0.03] border border-white/10 p-1 rounded-none">
            <button
              onClick={() => setActiveTab("overview")}
              className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 ${
                activeTab === "overview"
                  ? "bg-blue-500 text-white"
                  : "text-[#F9F9F7]/50 hover:text-white"
              }`}
            >
              Overview (Approval Center)
            </button>
            <button
              onClick={() => setActiveTab("personal")}
              className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 ${
                activeTab === "personal"
                  ? "bg-blue-500 text-white"
                  : "text-[#F9F9F7]/50 hover:text-white"
              }`}
            >
              Personal (Participant History)
            </button>
          </div>
        </div>
      </div>

      {/* 2.1 Method Snapshot Overview */}
      <div className="space-y-3">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40">Method Snapshot Overview</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paymentMethods.length === 0 ? (
            <div className="bg-white/[0.01] border border-white/5 p-4 text-xs text-[#F9F9F7]/40 italic">
              No payment methods configured.
            </div>
          ) : (
            paymentMethods.map((m: any) => {
              const totalAmount = getMethodTotal(m.name, m.accountNumber);
              const typeLabel = m.type === "bank" || m.type === "Bank Account" 
                ? "Bank Account" 
                : m.type === "wallet" || m.type === "E-Wallet" 
                  ? "E-Wallet" 
                  : "QRIS";
              return (
                <div key={m.id} className="bg-[#121214]/40 border border-white/5 p-4 flex flex-col justify-between hover:bg-white/[0.02] transition-all">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-white font-bold text-sm truncate">{m.name}</span>
                      <span className="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 uppercase tracking-wider font-mono font-bold">
                        {typeLabel}
                      </span>
                    </div>
                    {m.type !== "qris" && m.type !== "QRIS" ? (
                      <div className="mt-2 text-xs font-mono text-[#F9F9F7]/60">
                        <p className="truncate">Acc: {m.accountNumber}</p>
                        <p className="truncate">Holder: {m.accountHolder || m.accountName}</p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#F9F9F7]/40 italic mt-2">Static Interchange QRIS Node</p>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-baseline font-mono text-xs">
                    <span className="text-[#F9F9F7]/40">Verified Total:</span>
                    <span className="font-bold text-emerald-400 text-sm">{formatIDR(totalAmount)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeTab === "overview" ? (
        /* ================= OVERVIEW TAB (APPROVAL CENTER) ================= */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Pending Admin Verification
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : payments.filter(p => p.status === "Pending Verification").length === 0 ? (
            <div className="bg-white/[0.01] p-16 border border-white/5 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-500/60 mx-auto mb-3" />
              <p className="text-[#F9F9F7] font-medium text-sm">Inbox Cleared</p>
              <p className="text-[#F9F9F7]/40 text-xs mt-1">No payment declarations are currently pending verification.</p>
            </div>
          ) : (
            <div className="border border-white/5 bg-[#121214]/20 overflow-hidden shadow-2xl">
              <div className="overflow-x-auto text-left">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-[#121214]/60 text-[#F9F9F7]/40 text-[10px] font-mono font-bold uppercase tracking-widest border-b border-white/5">
                    <tr>
                      <th className="px-6 py-4">Participant</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Activity Date</th>
                      <th className="px-6 py-4">Method Snapshot</th>
                      <th className="px-6 py-4 text-right">Expected Amount</th>
                      <th className="px-6 py-4 text-right">Amount Submitted</th>
                      <th className="px-6 py-4 text-center">Proof</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {payments
                      .filter(p => p.status === "Pending Verification")
                      .map((p) => {
                        const formatSnapshotDetail = (snapshot: any) => {
                          if (!snapshot) return "—";
                          const typeLabel = snapshot.type === "bank" || snapshot.type === "Bank Account" 
                            ? "E-Banking" 
                            : snapshot.type === "wallet" || snapshot.type === "E-Wallet" 
                              ? "E-Wallet" 
                              : "QRIS";
                          return `[${typeLabel}] ${snapshot.name} - ${snapshot.accountNumber} (${snapshot.accountHolder || snapshot.accountName || "Admin"})`;
                        };

                        return (
                          <tr key={p.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-4">
                              <span className="font-semibold text-white block">{p.participantName}</span>
                              {p.notes && (
                                <span className="text-xs text-[#F9F9F7]/40 italic block mt-1 leading-relaxed">
                                  "{p.notes}"
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-[#F9F9F7]/70 text-xs font-medium">{p.categoryName}</td>
                            <td className="px-6 py-4 text-[#F9F9F7]/60 text-xs font-mono">
                              {new Date(p.createdAt || p.dates?.declarationDate).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-[#F9F9F7]/80">
                              {p.methodSnapshot ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSnapshot(p.methodSnapshot);
                                    setSnapshotSearch("");
                                    setSnapshotStatus("all");
                                    setSnapshotSortBy("name");
                                    setSnapshotSortOrder("asc");
                                    setSnapshotPage(1);
                                  }}
                                  className="text-left group hover:text-blue-400 transition-colors cursor-pointer block"
                                >
                                  <span className="font-bold underline group-hover:text-blue-400 block break-words max-w-[240px]">
                                    {formatSnapshotDetail(p.methodSnapshot)}
                                  </span>
                                </button>
                              ) : "—"}
                            </td>
                            <td className="px-6 py-4 text-right font-mono font-bold text-[#F9F9F7]/50 text-xs">
                              {formatIDR(p.expectedAmount || 0)}
                            </td>
                            <td className="px-6 py-4 text-right font-mono font-bold text-white text-sm">
                              {formatIDR(p.submittedAmount)}
                              {p.expectedAmount !== undefined && p.submittedAmount !== p.expectedAmount && (
                                <span className={`block text-[9px] uppercase tracking-wider mt-1 font-bold ${
                                  p.submittedAmount < p.expectedAmount ? "text-rose-400" : "text-emerald-400"
                                }`}>
                                  {p.submittedAmount < p.expectedAmount ? "Underpaid" : "Overpaid"}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {p.proofUrl ? (
                                <button 
                                  onClick={() => setLightboxUrl(p.proofUrl)}
                                  className="inline-flex items-center gap-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1.5 transition-all cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  View Image
                                </button>
                              ) : (
                                <span className="text-xs text-white/20 italic font-mono">No image</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[9px] font-mono uppercase tracking-widest font-bold px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                PENDING
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-1.5 font-mono text-[10px]">
                                <button 
                                  onClick={() => handleVerifyPayment(p.id, "approve")}
                                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 p-1.5 transition-all cursor-pointer"
                                  title="Approve and Reconcile balances"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => openRejectModal(p.id)}
                                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1.5 transition-all cursor-pointer"
                                  title="Reject submission"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleDeletePayment(p.id)}
                                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1.5 transition-all cursor-pointer"
                                  title="Delete payment record permanently"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ================= PERSONAL TAB (PARTICIPANT HISTORY) ================= */
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white/[0.01] p-4 border border-white/5">
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40 block mb-1">Select Participant</span>
                <select
                  value={selectedParticipantId}
                  onChange={(e) => setSelectedParticipantId(e.target.value)}
                  className="bg-[#0D0D0F] text-xs font-mono font-bold text-white border border-white/10 rounded-none px-3 py-2 w-52 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">ALL PARTICIPANTS</option>
                  {personalOverview.map(p => (
                    <option key={p.participantId} value={p.participantId}>
                      {p.fullName} ({p.nickname})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40 block mb-1">Filter Status</span>
                <select
                  value={personalStatusFilter}
                  onChange={(e) => setPersonalStatusFilter(e.target.value)}
                  className="bg-[#0D0D0F] text-xs font-mono font-bold text-white border border-white/10 rounded-none px-3 py-2 w-44 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">ALL STATUSES</option>
                  <option value="Not Paid">NOT PAID</option>
                  <option value="Pending Approval">PENDING APPROVAL</option>
                  <option value="Paid">PAID</option>
                  <option value="Rejected">REJECTED</option>
                </select>
              </div>

              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40 block mb-1">Search</span>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search participant or bill..."
                    value={personalSearch}
                    onChange={(e) => setPersonalSearch(e.target.value)}
                    className="bg-[#0D0D0F] text-xs font-mono text-white border border-white/10 rounded-none pl-8 pr-3 py-2 w-52 focus:outline-none focus:border-blue-500 placeholder:text-white/20"
                  />
                  <Search className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-2.5" />
                </div>
              </div>
            </div>

            <div className="text-xs font-mono text-[#F9F9F7]/40 max-w-sm leading-relaxed text-left md:text-right">
              Participant lifecycle statuses: <span className="text-zinc-400 font-bold">Not Paid</span>, <span className="text-amber-400 font-bold">Pending Approval</span>, <span className="text-emerald-400 font-bold">Paid</span>, and <span className="text-rose-400 font-bold">Rejected</span>.
            </div>
          </div>

          {personalLoading ? (
            <div className="flex justify-center py-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-8">
              {personalOverview
                .filter(p => selectedParticipantId === "all" || p.participantId === selectedParticipantId)
                .filter(p => {
                  if (!personalSearch) return true;
                  const query = personalSearch.toLowerCase();
                  const matchName = (p.fullName || "").toLowerCase().includes(query) || (p.nickname || "").toLowerCase().includes(query);
                  const matchTx = p.history.some((h: any) => (h.title || "").toLowerCase().includes(query) || (h.categoryName || "").toLowerCase().includes(query));
                  return matchName || matchTx;
                })
                .map(p => {
                  const filteredHistory = p.history.filter((h: any) => {
                    if (personalStatusFilter !== "all" && h.status !== personalStatusFilter) return false;
                    if (personalSearch) {
                      const query = personalSearch.toLowerCase();
                      const matchName = (p.fullName || "").toLowerCase().includes(query) || (p.nickname || "").toLowerCase().includes(query);
                      const matchTx = (h.title || "").toLowerCase().includes(query) || (h.categoryName || "").toLowerCase().includes(query) || (h.itemName || "").toLowerCase().includes(query);
                      if (!matchName && !matchTx) return false;
                    }
                    return true;
                  });

                  if (p.history.length === 0) {
                    return (
                      <div key={p.participantId} className="border border-white/5 bg-[#121214]/20 p-6 text-center">
                        <User className="w-6 h-6 text-white/20 mx-auto mb-2" />
                        <h3 className="font-bold text-white text-sm">{p.fullName}</h3>
                        <p className="text-[#F9F9F7]/40 text-xs mt-1">No split bill allocations assigned to this participant yet.</p>
                      </div>
                    );
                  }

                  const totalAllocations = p.history.reduce((sum: number, h: any) => sum + h.expectedAmount, 0);
                  const totalPaid = p.history.filter((h: any) => h.status === "Paid").reduce((sum: number, h: any) => sum + (Number(h.submittedAmount) || 0), 0);
                  const totalPending = p.history.filter((h: any) => h.status === "Pending Approval").reduce((sum: number, h: any) => sum + (Number(h.submittedAmount) || 0), 0);
                  const totalUnpaid = p.history.filter((h: any) => h.status === "Not Paid" || h.status === "Rejected").reduce((sum: number, h: any) => sum + h.expectedAmount, 0);

                  return (
                    <div key={p.participantId} className="border border-white/5 bg-[#121214]/20 overflow-hidden shadow-xl text-left">
                      {/* Participant Header Card */}
                      <div className="p-4 bg-white/[0.02] border-b border-white/5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div>
                          <h3 className="font-bold text-white text-base flex items-center gap-2">
                            <User className="w-4 h-4 text-blue-400" />
                            {p.fullName}
                            {p.nickname && p.nickname !== p.fullName && (
                              <span className="text-[#F9F9F7]/40 text-xs font-normal font-mono">({p.nickname})</span>
                            )}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 font-mono text-[10px] text-[#F9F9F7]/50">
                            <span>Phone: {p.phone}</span>
                            {p.email && <span>• Email: {p.email}</span>}
                          </div>
                        </div>

                        {/* 4 Metrics Summary Block */}
                        <div className="flex flex-wrap gap-2.5 font-mono text-xs">
                          <div className="bg-[#0D0D0F]/60 border border-white/5 px-3 py-1.5">
                            <span className="text-[9px] text-[#F9F9F7]/40 block uppercase tracking-wider">Total Allocations</span>
                            <span className="font-bold text-white">
                              {formatIDR(totalAllocations)}
                            </span>
                          </div>
                          <div className="bg-[#0D0D0F]/60 border border-emerald-500/20 px-3 py-1.5">
                            <span className="text-[9px] text-emerald-400/60 block uppercase tracking-wider">Paid / Verified</span>
                            <span className="font-bold text-emerald-400">
                              {formatIDR(totalPaid)}
                            </span>
                          </div>
                          <div className="bg-[#0D0D0F]/60 border border-amber-500/20 px-3 py-1.5">
                            <span className="text-[9px] text-amber-400/60 block uppercase tracking-wider">Pending Approval</span>
                            <span className="font-bold text-amber-400">
                              {formatIDR(totalPending)}
                            </span>
                          </div>
                          <div className="bg-[#0D0D0F]/60 border border-zinc-700/50 px-3 py-1.5">
                            <span className="text-[9px] text-zinc-400 block uppercase tracking-wider">Unpaid / Due</span>
                            <span className="font-bold text-rose-300">
                              {formatIDR(totalUnpaid)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Allocations Lifecycle List */}
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                          <thead className="bg-[#121214]/60 text-[#F9F9F7]/40 text-[9px] font-mono font-bold uppercase tracking-widest border-b border-white/5">
                            <tr>
                              <th className="px-6 py-3">Transaction Allocation</th>
                              <th className="px-6 py-3">Category</th>
                              <th className="px-6 py-3">Transaction Date</th>
                              <th className="px-6 py-3 text-right">Expected Amount</th>
                              <th className="px-6 py-3 text-right">Amount Submitted</th>
                              <th className="px-6 py-3">Personal Payment Status</th>
                              <th className="px-6 py-3">Payment Channel</th>
                              <th className="px-6 py-3 text-center">Proof / Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {filteredHistory.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-6 py-8 text-center text-xs text-[#F9F9F7]/30 italic font-mono">
                                  No transactions match the selected filter.
                                </td>
                              </tr>
                            ) : (
                              filteredHistory.map((h: any) => {
                                let statusBadge = "bg-[#27272A] text-zinc-300 border border-zinc-600/50";
                                let statusText = "Not Paid";

                                if (h.status === "Paid") {
                                  statusBadge = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                                  statusText = "Paid";
                                } else if (h.status === "Pending Approval") {
                                  statusBadge = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                                  statusText = "Pending Approval";
                                } else if (h.status === "Rejected") {
                                  statusBadge = "bg-rose-500/10 text-rose-400 border border-rose-500/20";
                                  statusText = "Rejected";
                                } else {
                                  statusBadge = "bg-zinc-800 text-zinc-300 border border-zinc-600/60";
                                  statusText = "Not Paid";
                                }

                                return (
                                  <tr key={h.id} className="hover:bg-white/[0.01] transition-colors">
                                    <td className="px-6 py-3.5">
                                      <span className="font-bold text-white block">{h.title}</span>
                                      <span className="text-[10px] text-[#F9F9F7]/40 font-mono block mt-0.5">
                                        {h.itemName || h.merchant || h.title}
                                      </span>
                                    </td>
                                    <td className="px-6 py-3.5 text-white/70">{h.categoryName}</td>
                                    <td className="px-6 py-3.5 text-[#F9F9F7]/60 font-mono">
                                      {new Date(h.date).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                                    </td>
                                    <td className="px-6 py-3.5 text-right font-bold text-[#F9F9F7]/80 font-mono">
                                      {formatIDR(h.expectedAmount)}
                                    </td>
                                    <td className="px-6 py-3.5 text-right font-bold text-white font-mono">
                                      {h.submittedAmount === "Not Paid" ? (
                                        <span className="text-zinc-400 italic text-[11px] font-mono">Not Paid</span>
                                      ) : (
                                        formatIDR(h.submittedAmount)
                                      )}
                                    </td>
                                    <td className="px-6 py-3.5">
                                      <span className={`px-2.5 py-1 font-mono font-bold text-[9px] uppercase tracking-wider inline-block ${statusBadge}`}>
                                        {statusText}
                                      </span>
                                      {h.rejectionReason && (
                                        <span className="text-[10px] text-rose-400 block mt-1 italic max-w-[180px] break-words">
                                          Reason: {h.rejectionReason}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-6 py-3.5 font-mono text-[10px] text-[#F9F9F7]/60">
                                      {h.methodSnapshot ? h.methodSnapshot.name : "—"}
                                    </td>
                                    <td className="px-6 py-3.5 text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        {h.proofUrl && (
                                          <button
                                            onClick={() => setLightboxUrl(h.proofUrl)}
                                            className="inline-flex items-center gap-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 transition-all cursor-pointer"
                                            title="View Uploaded Payment Proof"
                                          >
                                            <Eye className="w-3 h-3" />
                                            Proof
                                          </button>
                                        )}
                                        {h.status === "Pending Approval" && h.submissionId && (
                                          <button
                                            onClick={() => handleVerifyPayment(h.submissionId, "approve")}
                                            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 p-1 transition-all cursor-pointer"
                                            title="Approve payment"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {h.submissionId && h.status !== "Rejected" && (
                                          <button
                                            onClick={() => openRejectModal(h.submissionId)}
                                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1 transition-all cursor-pointer"
                                            title={h.status === "Paid" ? "Reopen and reject this approved payment" : "Reject payment"}
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {h.submissionId && (
                                          <button
                                            onClick={() => openEditModal(h)}
                                            className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 p-1 transition-all cursor-pointer"
                                            title="Edit submitted amount"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {h.submissionId && (
                                          <button
                                            onClick={() => handleDeletePayment(h.submissionId)}
                                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1 transition-all cursor-pointer"
                                            title="Delete payment record permanently"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {!h.proofUrl && !h.submissionId && (
                                          <span className="text-white/20 italic font-mono text-[10px]">—</span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* LIGHTBOX MODAL FOR PREVIEW PROOFS */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-[#0D0D0F]/90 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="relative max-w-3xl max-h-[90vh] bg-[#121214] border border-white/10 p-2 overflow-hidden shadow-2xl flex flex-col items-center">
            <button 
              onClick={() => setLightboxUrl(null)} 
              className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2 rounded-full text-white cursor-pointer z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={lightboxUrl} 
              alt="Payment proof of transfer"
              className="max-w-full max-h-[80vh] object-contain"
              referrerPolicy="no-referrer"
            />
            <p className="text-[#F9F9F7]/40 text-[10px] font-mono uppercase tracking-widest mt-4">Uploaded Payment Declaration Proof Lightbox Reference</p>
          </div>
        </div>
      )}

      {/* REJECTION REASON MODAL (AC-017) */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                Reject Declaration_
              </h3>
              <button onClick={() => setShowRejectModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-rose-950/20 border border-rose-900/30 text-xs text-rose-300 flex gap-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <p className="leading-relaxed">Rejecting a payment releases the transaction obligations back into payable unpaid state so the participant can submit details again.</p>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Rejection Reason *</label>
                <textarea 
                  required
                  placeholder="e.g. Uploaded image is blurry or amount does not match transfer records."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none p-3.5 text-xs h-28 focus:outline-none focus:border-blue-500 text-white resize-none font-sans placeholder:opacity-30"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  onClick={() => setShowRejectModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    if (!rejectionReason) {
                      onShowNotification("Please provide a rejection reason.", "error");
                      return;
                    }
                    if (selectedSubId) {
                      handleVerifyPayment(selectedSubId, "reject", rejectionReason);
                    }
                  }}
                  className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold cursor-pointer"
                >
                  Reject Submission
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SUBMITTED AMOUNT MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-400" />
                Edit Submission_
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-blue-950/20 border border-blue-900/30 text-xs text-blue-300 flex gap-3">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                <p className="leading-relaxed">Correcting the submitted amount on an already-approved payment will also recalculate its balance allocation across the covered transactions.</p>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Submitted Amount (IDR) *</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none p-3.5 text-sm focus:outline-none focus:border-blue-500 text-white font-mono placeholder:opacity-30"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEditPayment}
                  className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* METHOD SNAPSHOT BREAKDOWN MODAL */}
      {selectedSnapshot && (() => {
        const matchingPayments = payments.filter(ps => 
          ps.methodSnapshot?.name === selectedSnapshot?.name && 
          ps.methodSnapshot?.accountNumber === selectedSnapshot?.accountNumber
        );

        const filteredSnapshotPayments = matchingPayments.filter(ps => {
          if (snapshotStatus !== "all" && ps.status !== snapshotStatus) return false;
          if (snapshotSearch) {
            const query = snapshotSearch.toLowerCase();
            const partName = (ps.participantName || "").toLowerCase();
            const catName = (ps.categoryName || "").toLowerCase();
            if (!partName.includes(query) && !catName.includes(query)) return false;
          }
          return true;
        });

        const sortedSnapshotPayments = [...filteredSnapshotPayments].sort((a, b) => {
          let compareVal = 0;
          if (snapshotSortBy === "name") {
            compareVal = (a.participantName || "").localeCompare(b.participantName || "");
          } else if (snapshotSortBy === "amount") {
            compareVal = (a.submittedAmount || 0) - (b.submittedAmount || 0);
          } else if (snapshotSortBy === "date") {
            const dateA = new Date(a.createdAt || a.dates?.declarationDate || 0).getTime();
            const dateB = new Date(b.createdAt || b.dates?.declarationDate || 0).getTime();
            compareVal = dateA - dateB;
          }
          return snapshotSortOrder === "asc" ? compareVal : -compareVal;
        });

        const itemsPerPage = 5;
        const totalPages = Math.ceil(sortedSnapshotPayments.length / itemsPerPage);
        const paginatedSnapshotPayments = sortedSnapshotPayments.slice(
          (snapshotPage - 1) * itemsPerPage,
          snapshotPage * itemsPerPage
        );

        const totalSnapshotAmount = matchingPayments.reduce((sum, p) => sum + (p.submittedAmount || 0), 0);

        const handleExportCSV = () => {
          const csvRows = [
            ["Participant Name", "Category / Event Name", "Submitted Amount", "Status", "Date Submitted"],
            ...filteredSnapshotPayments.map(ps => [
              ps.participantName,
              ps.categoryName,
              ps.submittedAmount,
              ps.status,
              new Date(ps.createdAt || ps.dates?.declarationDate).toISOString()
            ])
          ];

          const csvContent = "data:text/csv;charset=utf-8," 
            + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
          
          const encodedUri = encodeURI(csvContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", `payment_snapshot_${selectedSnapshot.name.replace(/\s+/g, "_")}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          onShowNotification("CSV export downloaded.", "success");
        };

        const toggleSort = (field: "name" | "amount" | "date") => {
          if (snapshotSortBy === field) {
            setSnapshotSortOrder(prev => prev === "asc" ? "desc" : "asc");
          } else {
            setSnapshotSortBy(field);
            setSnapshotSortOrder("asc");
          }
          setSnapshotPage(1);
        };

        return (
          <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#121214] border border-white/10 w-full max-w-4xl overflow-hidden text-left shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div>
                  <span className="text-blue-500 font-mono text-[9px] tracking-widest uppercase block mb-1">Transfer Channel Snapshot</span>
                  <h3 className="editorial-title italic text-2xl text-white">
                    {selectedSnapshot.name} Breakdown_
                  </h3>
                </div>
                <button onClick={() => setSelectedSnapshot(null)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
                  <div className="bg-white/[0.02] border border-white/5 p-4 flex flex-col justify-between">
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">Total Transactions</span>
                    <span className="text-2xl font-bold text-white mt-2">{matchingPayments.length} records</span>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 p-4 flex flex-col justify-between">
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">Total Amount</span>
                    <span className="text-2xl font-bold text-blue-400 mt-2">{formatIDR(totalSnapshotAmount)}</span>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 p-4 flex flex-col justify-between">
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">Preferred Status</span>
                    <span className={`text-sm font-bold mt-3.5 px-2.5 py-1 w-max ${
                      selectedSnapshot.isPreferred || selectedSnapshot.preferred
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-white/5 text-white/50 border border-white/10"
                    }`}>
                      {selectedSnapshot.isPreferred || selectedSnapshot.preferred ? "PREFERRED DEFAULT" : "STANDARD CHANNEL"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white/[0.01] p-4 border border-white/5">
                  <div className="relative w-full md:w-72">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Search participant or event..."
                      value={snapshotSearch}
                      onChange={(e) => { setSnapshotSearch(e.target.value); setSnapshotPage(1); }}
                      className="w-full bg-[#0D0D0F] border border-white/10 pl-9 pr-4 py-2 text-xs text-white placeholder:opacity-30 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center gap-2 border border-white/10 bg-[#0D0D0F] px-3 py-2 text-xs">
                      <span className="text-white/40 uppercase font-mono tracking-wider text-[9px]">Status:</span>
                      <select
                        value={snapshotStatus}
                        onChange={(e) => { setSnapshotStatus(e.target.value); setSnapshotPage(1); }}
                        className="bg-transparent text-[#F9F9F7]/70 font-bold focus:outline-none cursor-pointer uppercase"
                      >
                        <option value="all" className="bg-[#121214]">All</option>
                        <option value="Pending Verification" className="bg-[#121214]">Pending</option>
                        <option value="Paid" className="bg-[#121214]">Paid</option>
                        <option value="Rejected" className="bg-[#121214]">Rejected</option>
                      </select>
                    </div>

                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 bg-white text-black hover:bg-neutral-200 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>
                </div>

                <div className="border border-white/5 bg-[#121214]/10 overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#121214]/60 text-[#F9F9F7]/40 text-[9px] font-mono font-bold uppercase tracking-widest border-b border-white/5">
                      <tr>
                        <th className="px-6 py-3 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => toggleSort("name")}>
                          <div className="flex items-center gap-1">
                            Participant Name
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="px-6 py-3">Category Name</th>
                        <th className="px-6 py-3 cursor-pointer hover:bg-white/5 transition-colors text-right" onClick={() => toggleSort("amount")}>
                          <div className="flex items-center justify-end gap-1">
                            Submitted Amount
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 cursor-pointer hover:bg-white/5 transition-colors text-right" onClick={() => toggleSort("date")}>
                          <div className="flex items-center justify-end gap-1">
                            Date Submitted
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                      {paginatedSnapshotPayments.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-white/30 italic">No matching records found.</td>
                        </tr>
                      ) : (
                        paginatedSnapshotPayments.map(ps => {
                          let badge = "bg-white/5 text-white/60";
                          if (ps.status === "Paid") badge = "bg-emerald-500/10 text-emerald-400";
                          if (ps.status === "Pending Verification") badge = "bg-amber-500/10 text-amber-400";
                          if (ps.status === "Rejected") badge = "bg-rose-500/10 text-rose-400";

                          return (
                            <tr key={ps.id} className="hover:bg-white/[0.01] transition-colors">
                              <td className="px-6 py-3.5 text-white font-bold font-sans">{ps.participantName}</td>
                              <td className="px-6 py-3.5 text-white/70 font-sans">{ps.categoryName}</td>
                              <td className="px-6 py-3.5 text-right text-white font-bold">{formatIDR(ps.submittedAmount)}</td>
                              <td className="px-6 py-3.5">
                                <span className={`px-2 py-0.5 font-bold uppercase text-[9px] ${badge}`}>
                                  {ps.status}
                                </span>
                              </td>
                              <td className="px-6 py-3.5 text-right text-white/50">
                                {new Date(ps.createdAt || ps.dates?.declarationDate).toLocaleDateString("id-ID", { dateStyle: "short" })}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex justify-between items-center font-mono text-[10px] text-white/50 uppercase tracking-widest pt-4">
                    <span>Page {snapshotPage} of {totalPages}</span>
                    <div className="flex gap-2">
                      <button
                        disabled={snapshotPage === 1}
                        onClick={() => setSnapshotPage(prev => Math.max(prev - 1, 1))}
                        className="p-2 border border-white/10 hover:bg-white/5 disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={snapshotPage === totalPages}
                        onClick={() => setSnapshotPage(prev => Math.min(prev + 1, totalPages))}
                        className="p-2 border border-white/10 hover:bg-white/5 disabled:opacity-20 cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
