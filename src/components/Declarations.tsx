import React, { useState, useEffect } from "react";
import { RefreshCw, Check, X, AlertTriangle, ClipboardList, ShieldAlert } from "lucide-react";

interface DeclarationsProps {
  token: string;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

interface Declaration {
  id: string;
  transactionId: string;
  participantName: string;
  transactionTitle: string;
  transactionDate: string;
  categoryName: string;
  declaredAmount: number;
}

export default function Declarations({ token, onShowNotification }: DeclarationsProps) {
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [loading, setLoading] = useState(true);

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedDeclaration, setSelectedDeclaration] = useState<Declaration | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchDeclarations = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/transactions/declarations", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setDeclarations(await res.json());
      } else {
        onShowNotification("Gagal mengambil data deklarasi peserta.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan saat mengambil data deklarasi.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeclarations();
  }, []);

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  const handleApprove = async (d: Declaration) => {
    try {
      const res = await fetch(`/api/transactions/${d.transactionId}/free-input/${d.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ action: "approve" })
      });

      if (res.ok) {
        onShowNotification(`Deklarasi ${d.participantName} disetujui.`, "success");
        fetchDeclarations();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menyetujui deklarasi.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan.", "error");
    }
  };

  const openRejectModal = (d: Declaration) => {
    setSelectedDeclaration(d);
    setRejectionReason("");
    setShowRejectModal(true);
  };

  const handleReject = async () => {
    if (!selectedDeclaration) return;
    if (!rejectionReason) {
      onShowNotification("Silakan isi alasan penolakan.", "error");
      return;
    }

    try {
      const res = await fetch(`/api/transactions/${selectedDeclaration.transactionId}/free-input/${selectedDeclaration.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ action: "reject", rejectionReason })
      });

      if (res.ok) {
        onShowNotification(`Deklarasi ${selectedDeclaration.participantName} ditolak.`, "success");
        setShowRejectModal(false);
        setSelectedDeclaration(null);
        fetchDeclarations();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menolak deklarasi.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan.", "error");
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-white/5 pb-8">
        <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Free input review center</span>
        <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
          Declarations_
        </h1>
        <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
          Tinjau nominal yang didekralasikan sendiri oleh peserta untuk transaksi tanpa rincian harga pasti (mis. tidak ada struk). Setujui untuk menjadikannya tanggungan resmi, atau tolak agar peserta bisa input ulang.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : declarations.length === 0 ? (
        <div className="bg-white/[0.01] p-16 border border-white/5 text-center">
          <ClipboardList className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-[#F9F9F7] font-medium text-sm">Tidak Ada Deklarasi Menunggu</p>
          <p className="text-[#F9F9F7]/40 text-xs mt-1">Semua deklarasi input bebas dari peserta sudah ditinjau.</p>
        </div>
      ) : (
        <div className="border border-white/5 bg-[#121214]/20 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-[#121214]/60 text-[#F9F9F7]/40 text-[10px] font-mono font-bold uppercase tracking-widest border-b border-white/5">
                <tr>
                  <th className="px-6 py-4">Peserta</th>
                  <th className="px-6 py-4">Transaksi</th>
                  <th className="px-6 py-4">Kategori</th>
                  <th className="px-6 py-4">Tanggal</th>
                  <th className="px-6 py-4 text-right">Nominal Dideklarasikan</th>
                  <th className="px-6 py-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {declarations.map((d) => (
                  <tr key={d.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-6 py-4 font-semibold text-white">{d.participantName}</td>
                    <td className="px-6 py-4 text-[#F9F9F7]/70 text-xs">{d.transactionTitle}</td>
                    <td className="px-6 py-4 text-[#F9F9F7]/70 text-xs">{d.categoryName}</td>
                    <td className="px-6 py-4 text-[#F9F9F7]/60 font-mono text-xs">
                      {d.transactionDate ? new Date(d.transactionDate).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "—"}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-white">{formatIDR(d.declaredAmount)}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleApprove(d)}
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 p-1.5 transition-all cursor-pointer"
                          title="Setujui deklarasi"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openRejectModal(d)}
                          className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1.5 transition-all cursor-pointer"
                          title="Tolak deklarasi"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRejectModal && selectedDeclaration && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                Tolak Deklarasi_
              </h3>
              <button onClick={() => setShowRejectModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-rose-950/20 border border-rose-900/30 text-xs text-rose-300 flex gap-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <p className="leading-relaxed">
                  Menolak deklarasi ini akan membuka kembali input bebas untuk {selectedDeclaration.participantName} pada transaksi "{selectedDeclaration.transactionTitle}", sehingga mereka bisa mengisi nominal baru lewat link pribadi mereka.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Alasan Penolakan *</label>
                <textarea
                  required
                  placeholder="cth. Nominal terlalu besar dibanding rata-rata patungan lainnya."
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
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold cursor-pointer"
                >
                  Tolak Deklarasi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
