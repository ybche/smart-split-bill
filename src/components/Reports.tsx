import React, { useState, useEffect } from "react";
import { 
  FileSpreadsheet, Download, RefreshCw, BarChart2, Info, Users, 
  DollarSign, Activity, Calendar, FileText, ChevronRight
} from "lucide-react";
import { Category, Participant, PaymentSubmission } from "../types";

interface ReportsProps {
  token: string;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Reports({ token, onShowNotification }: ReportsProps) {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [payments, setPayments] = useState<PaymentSubmission[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Detailed totals
  const [totals, setTotals] = useState({
    totalSpent: 0,
    reimbursed: 0,
    outstanding: 0,
    pending: 0
  });

  const fetchReportsData = async () => {
    setLoading(true);
    try {
      const headers = { "Authorization": `Bearer ${token}` };
      const [resCat, resPart, resPay, resAct] = await Promise.all([
        fetch("/api/categories", { headers }),
        fetch("/api/participants", { headers }),
        fetch("/api/payments", { headers }),
        fetch("/api/activities", { headers })
      ]);

      if (resCat.ok && resPart.ok && resPay.ok && resAct.ok) {
        const catData = await resCat.json();
        const partData = await resPart.json();
        const payData = await resPay.json();
        const logsData = await resAct.json();

        setCategories(catData);
        setParticipants(partData);
        setPayments(payData);
        setAuditLogs(logsData);

        // Fetch overall database transactions to get total transaction value
        const resTx = await fetch("/api/transactions", { headers });
        if (resTx.ok) {
          const txData = await resTx.json();
          const totalSpent = txData.reduce((sum: number, t: any) => sum + t.total, 0);
          
          const reimbursed = payData
            .filter((p: any) => p.status === "Paid")
            .reduce((sum: number, p: any) => sum + p.submittedAmount, 0);

          const pending = payData
            .filter((p: any) => p.status === "Pending Verification")
            .reduce((sum: number, p: any) => sum + p.submittedAmount, 0);

          const outstanding = Math.max(0, totalSpent - reimbursed);

          setTotals({ totalSpent, reimbursed, outstanding, pending });
        }
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil data laporan.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportsData();
  }, []);

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  // Export Data as JSON file (REP-001)
  const exportAsJSON = () => {
    try {
      const jsonString = JSON.stringify({
        exportDate: new Date().toISOString(),
        financialSummary: totals,
        categories,
        participants,
        payments
      }, null, 2);
      
      const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      
      const downloadAnchor = document.createElement("a");
      downloadAnchor.href = url;
      downloadAnchor.setAttribute("download", "smart_split_bill_financial_report.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);
      
      onShowNotification("Financial database exported as JSON successfully!", "success");
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengekspor database JSON.", "error");
    }
  };

  // Export Data as CSV file (REP-002)
  const exportAsCSV = () => {
    try {
      // Header
      let csvContent = "Participant ID,Full Name,Phone,Email,Approved Verified Paid Amount,Status\n";
      
      participants.forEach(p => {
        // Calculate total paid approved
        const userPaid = payments
          .filter(pay => pay.participantId === p.id && pay.status === "Paid")
          .reduce((sum, pay) => sum + pay.submittedAmount, 0);

        csvContent += `"${p.id}","${p.fullName}","${p.normalizedPhone}","${p.email || ""}","${userPaid}","${p.active ? "Active" : "Archived"}"\n`;
      });

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const downloadAnchor = document.createElement("a");
      downloadAnchor.href = url;
      downloadAnchor.setAttribute("download", "smart_split_bill_members_balances.csv");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);

      onShowNotification("Outstanding balances exported as CSV!", "success");
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengekspor saldo CSV.", "error");
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Title & Exports */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">System summaries & exports</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Reports_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Download complete financial split logs, analyze participant balances, and inspect the structural change log timeline.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={exportAsCSV}
            className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white font-mono font-bold uppercase tracking-widest text-[10px] px-4 py-3 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Member CSV
          </button>
          <button 
            onClick={exportAsJSON}
            className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-5 py-3 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Database JSON
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Detailed Financial Analytics Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Category Performance Card */}
            <div className="bg-[#121214]/40 p-6 border border-white/5 shadow-2xl col-span-1 lg:col-span-2">
              <h3 className="text-[10px] font-mono font-bold text-white/40 uppercase tracking-widest mb-5 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                Category Performance Summary
              </h3>
              
              <div className="space-y-4">
                {categories.map(cat => {
                  let badge = "bg-white/5 border border-white/10 text-white/50";
                  if (cat.status === "Ongoing") badge = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                  if (cat.status === "Completed") badge = "bg-blue-500/10 text-blue-400 border border-blue-500/20";
 
                  // Find payments for this category
                  const catPays = payments.filter(p => p.categoryId === cat.id && p.status === "Paid");
                  const collected = catPays.reduce((sum, p) => sum + p.submittedAmount, 0);

                  return (
                    <div key={cat.id} className="p-4 bg-[#0D0D0F]/40 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-semibold text-white text-sm block">{cat.name}</span>
                          <span className="text-[9px] text-[#F9F9F7]/30 font-mono mt-1.5 uppercase tracking-wider">Category UID: {cat.id}</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-none ${badge}`}>{cat.status}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-5 text-xs font-mono">
                        <div>
                          <span className="text-[#F9F9F7]/40 block uppercase text-[9px] font-bold tracking-wider">Verified Collected:</span>
                          <span className="font-bold text-emerald-400 mt-1 block text-sm">{formatIDR(collected)}</span>
                        </div>
                        <div>
                          <span className="text-[#F9F9F7]/40 block uppercase text-[9px] font-bold tracking-wider">Notes / Split Rules:</span>
                          <span className="text-[#F9F9F7]/60 mt-1 block truncate text-xs">{cat.notes || "None configured"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Analytics Summary Panel */}
            <div className="bg-[#121214]/40 p-6 border border-white/5 shadow-2xl col-span-1 space-y-4">
              <h3 className="text-[10px] font-mono font-bold text-white/40 uppercase tracking-widest mb-5">Overall split metrics</h3>
              
              <div className="p-4 bg-[#0D0D0F]/40 border border-white/5 flex items-start gap-3.5">
                <div className="p-2 bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-mono font-bold text-white/40 block uppercase tracking-wider">Total spend pooled</span>
                  <span className="text-xl font-mono font-bold text-[#F9F9F7] block mt-1">{formatIDR(totals.totalSpent)}</span>
                </div>
              </div>

              <div className="p-4 bg-[#0D0D0F]/40 border border-white/5 flex items-start gap-3.5">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-mono font-bold text-white/40 block uppercase tracking-wider">Verified collections</span>
                  <span className="text-xl font-mono font-bold text-emerald-400 block mt-1">{formatIDR(totals.reimbursed)}</span>
                </div>
              </div>

              <div className="p-4 bg-[#0D0D0F]/40 border border-white/5 flex items-start gap-3.5">
                <div className="p-2 bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[9px] font-mono font-bold text-white/40 block uppercase tracking-wider">Outstanding debts</span>
                  <span className="text-xl font-mono font-bold text-rose-400 block mt-1">{formatIDR(totals.outstanding)}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Audit Trail Timeline */}
          <div className="bg-[#121214]/40 p-6 border border-white/5 shadow-2xl text-left">
            <h3 className="text-[10px] font-mono font-bold text-white/40 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              Full System Activity & Security Logs
            </h3>
            
            {auditLogs.length === 0 ? (
              <p className="text-xs text-white/20 italic font-mono">No activity logs recorded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-[#0D0D0F]/30 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] font-mono">
                    <div className="flex items-start sm:items-center gap-2.5 flex-wrap">
                      <span className="text-[8px] bg-white/5 text-[#F9F9F7]/70 border border-white/10 px-1.5 py-0.5 font-bold uppercase tracking-wide shrink-0">
                        {log.actorType}
                      </span>
                      <span className="text-[#F9F9F7]/60">
                        {log.entityType} id: <span className="text-blue-400">{log.entityId}</span> was <span className="text-white font-bold">{log.action}</span>
                      </span>
                    </div>

                    <div className="text-white/30 text-[9px] shrink-0">
                      {new Date(log.createdAt).toLocaleString("id-ID")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
