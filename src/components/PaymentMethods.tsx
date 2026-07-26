import React, { useState, useEffect } from "react";
import { 
  CreditCard, Landmark, Plus, Trash2, CheckCircle2, RefreshCw, X, 
  Info, QrCode, FileUp, ShieldCheck
} from "lucide-react";
import { PaymentMethod } from "../types";

interface PaymentMethodsProps {
  token: string;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function PaymentMethods({ token, onShowNotification }: PaymentMethodsProps) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<'Bank Account' | 'E-Wallet' | 'QRIS'>("Bank Account");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [isPreferred, setIsPreferred] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [qrisImageBase64, setQrisImageBase64] = useState("");

  const fetchMethods = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payment-methods", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setMethods(await res.json());
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil metode pembayaran.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMethods();
  }, []);

  const handleQRISUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      setQrisImageBase64(reader.result as string);
      onShowNotification("Static QRIS image uploaded and encoded!", "success");
    };
  };

  const handleSaveMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || (type !== "QRIS" && !accountNumber)) {
      onShowNotification("Payment Method name and Account Details are required.", "error");
      return;
    }

    try {
      const res = await fetch("/api/payment-methods", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          type,
          accountNumber: type === "QRIS" ? "STATIC_QRIS_STANDARDIZED" : accountNumber,
          accountName,
          isPreferred,
          instructions,
          qrisImage: qrisImageBase64
        })
      });

      if (res.ok) {
        onShowNotification("Payment method configured successfully!", "success");
        setShowModal(false);
        // Reset form
        setName("");
        setType("Bank Account");
        setAccountNumber("");
        setAccountName("");
        setIsPreferred(false);
        setInstructions("");
        setQrisImageBase64("");
        fetchMethods();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal mengatur metode pembayaran.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMethod = async (id: string) => {
    if (!confirm("Are you sure you want to remove this payment instruction? Future invoices cannot select this method.")) {
      return;
    }

    try {
      const res = await fetch(`/api/payment-methods/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Payment instruction removed.", "success");
        fetchMethods();
      } else {
        onShowNotification("Gagal menghapus metode pembayaran.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTogglePreferred = async (id: string) => {
    try {
      const res = await fetch(`/api/payment-methods/${id}/preferred`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Preferred payment method updated.", "success");
        fetchMethods();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Transfer node setup</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Methods_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Configure bank transfer accounts, GoPay links, or upload static Indonesian QRIS code graphics for participant portals.
          </p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-5 py-3 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Channel
        </button>
      </div>

      {/* Methods directory list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : methods.length === 0 ? (
        <div className="bg-white/[0.01] p-16 border border-white/5 text-center">
          <CreditCard className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-[#F9F9F7] font-medium text-sm">No Payment Methods Configured</p>
          <p className="text-[#F9F9F7]/40 text-xs mt-1">Configure Bank details, e-wallets, or QRIS templates for members to see.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
          {methods.map(m => (
            <div 
              key={m.id}
              className={`bg-[#121214]/40 p-6 border transition-all flex flex-col justify-between ${
                m.isPreferred ? "border-blue-500/40 ring-1 ring-blue-500/10 shadow-2xl" : "border-white/5 hover:border-white/10"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {m.type === "Bank Account" && <Landmark className="w-4 h-4 text-blue-400" />}
                    {m.type === "E-Wallet" && <CreditCard className="w-4 h-4 text-emerald-400" />}
                    {m.type === "QRIS" && <QrCode className="w-4 h-4 text-amber-400" />}
                    
                    <span className="font-semibold text-white text-sm">{m.name}</span>
                  </div>

                  <button 
                    onClick={() => handleTogglePreferred(m.id)}
                    className={`text-[9px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded-none transition-colors cursor-pointer ${
                      m.isPreferred ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "bg-white/5 hover:bg-white/10 text-white/50 border border-white/10"
                    }`}
                  >
                    {m.isPreferred ? "Preferred" : "Make Default"}
                  </button>
                </div>

                <div className="mt-5 space-y-3.5 text-xs text-[#F9F9F7]/70">
                  {m.type !== "QRIS" && (
                    <div className="space-y-2 bg-[#0D0D0F]/40 p-3.5 border border-white/5">
                      <div className="flex justify-between font-mono text-[11px]">
                        <span className="text-white/40">NUMBER:</span>
                        <span className="font-bold text-white tracking-wider">{m.accountNumber}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-white/40 font-mono">HOLDER:</span>
                        <span className="font-bold text-[#F9F9F7]">{m.accountName}</span>
                      </div>
                    </div>
                  )}

                  {m.type === "QRIS" && (
                    <div className="flex flex-col items-center justify-center p-4 bg-[#0D0D0F]/40 border border-white/5">
                      {m.qrisImage ? (
                        <img 
                          src={m.qrisImage} 
                          alt="Static QRIS Code" 
                          className="w-32 h-32 object-contain bg-white border border-white/10 p-1 mb-2"
                        />
                      ) : (
                        <QrCode className="w-10 h-10 text-white/20 mb-2" />
                      )}
                      <span className="text-[9px] font-mono font-bold tracking-widest text-[#F9F9F7]/40">STATIC INDONESIAN QRIS</span>
                    </div>
                  )}

                  {m.instructions && (
                    <p className="p-3 bg-white/[0.01] border border-white/5 text-[11px] text-[#F9F9F7]/50 italic font-sans leading-relaxed">
                      Instructions: "{m.instructions}"
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end border-t border-white/5 pt-4 mt-6">
                <button 
                  onClick={() => handleDeleteMethod(m.id)}
                  className="text-[10px] font-mono uppercase tracking-wider font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove Channel
                </button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* CREATE NEW METHOD MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white">Add Method_</h3>
              <button onClick={() => setShowModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMethod} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Payment Type *</label>
                <select 
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-mono cursor-pointer"
                >
                  <option value="Bank Account" className="bg-[#121214]">Bank Transfer Account</option>
                  <option value="E-Wallet" className="bg-[#121214]">E-Wallet (GoPay, OVO, Dana)</option>
                  <option value="QRIS" className="bg-[#121214]">Static QRIS Code Graphic</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Provider / Account Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. BCA, Mandiri, GoPay"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-sans placeholder:opacity-30"
                />
              </div>

              {type !== "QRIS" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Account Number *</label>
                      <input 
                        type="text"
                        required
                        placeholder="e.g. 1234567890"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-mono placeholder:opacity-30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Account Holder *</label>
                      <input 
                        type="text"
                        required
                        placeholder="e.g. Yeb"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-sans placeholder:opacity-30"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Static QRIS QR Code Graphic</label>
                  <label className="flex flex-col items-center justify-center p-4 border border-dashed border-white/10 bg-white/[0.01] hover:bg-white/[0.03] cursor-pointer transition-all">
                    <FileUp className="w-5 h-5 text-white/30 mb-2" />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white/50">Upload QRIS PNG/JPG</span>
                    <input 
                      type="file"
                      accept="image/*"
                      onChange={handleQRISUpload}
                      className="hidden"
                    />
                  </label>
                  {qrisImageBase64 && (
                    <div className="text-center bg-[#0D0D0F]/50 p-3 border border-white/5">
                      <img src={qrisImageBase64} alt="Encoded Preview" className="w-24 h-24 mx-auto object-contain bg-white p-1 mb-2" referrerPolicy="no-referrer" />
                      <span className="text-[9px] text-emerald-400 font-mono font-bold tracking-widest uppercase">✓ Base64 Encoded</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Memo / Custom Instructions</label>
                <input 
                  type="text"
                  placeholder="e.g. Please add your name in transfer note..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-[#F9F9F7]/70 cursor-pointer pt-2 font-mono">
                <input 
                  type="checkbox"
                  checked={isPreferred}
                  onChange={(e) => setIsPreferred(e.target.checked)}
                  className="border-white/20 bg-white/5 rounded-none text-blue-500 focus:ring-0 cursor-pointer"
                />
                <span>Default Preferred Selection on Portals</span>
              </label>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2.5 bg-white text-black font-bold hover:bg-neutral-200 cursor-pointer"
                >
                  Confirm Config
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
