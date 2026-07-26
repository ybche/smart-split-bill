import React, { useState, useEffect } from "react";
import { 
  Users, UserPlus, Search, Edit3, Trash2, ArrowRightLeft, RefreshCw, X, 
  Info, Mail, Phone, Bookmark, CheckCircle, MapPin, Tag
} from "lucide-react";
import { Participant } from "../types";

interface ParticipantsProps {
  token: string;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Participants({ token, onShowNotification }: ParticipantsProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal Form State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);

  // Merge duplicates Modal state (PAR-006)
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");

  const fetchParticipants = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/participants", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setParticipants(data);
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil daftar peserta.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, []);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setFullName("");
    setPhone("");
    setEmail("");
    setNickname("");
    setNotes("");
    setActive(true);
    setShowModal(true);
  };

  const handleOpenEditModal = (p: Participant) => {
    setEditingId(p.id);
    setFullName(p.fullName);
    setPhone(p.normalizedPhone);
    setEmail(p.email || "");
    setNickname(p.nickname || "");
    setNotes(p.notes || "");
    setActive(p.active);
    setShowModal(true);
  };

  const handleSaveParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !phone) {
      onShowNotification("Full Name and Phone/WhatsApp are required.", "error");
      return;
    }

    const payload = { fullName, phone, email, nickname, notes, active };

    try {
      const url = editingId ? `/api/participants/${editingId}` : "/api/participants";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        onShowNotification(editingId ? "Participant updated." : "Participant registered in directory.", "success");
        setShowModal(false);
        fetchParticipants();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menyimpan peserta.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan.", "error");
    }
  };

  const handleDeleteParticipant = async (pId: string, force = false) => {
    if (!force && !confirm("Are you sure you want to delete this participant from the master directory? This action will check for active allocations first.")) {
      return;
    }

    try {
      const res = await fetch(`/api/participants/${pId}${force ? "?force=true" : ""}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Participant deleted successfully.", "success");
        fetchParticipants();
      } else {
        const err = await res.json();
        if (res.status === 400 && err.canForce) {
          if (confirm(`${err.error}\n\nDo you want to FORCE CASCADE DELETE? This will permanently remove their allocations and payment submissions as well. WARNING: This action cannot be undone.`)) {
            handleDeleteParticipant(pId, true);
            return;
          }
        }
        onShowNotification(err.error || "Gagal menghapus peserta.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Merge duplicate participants logic (PAR-006)
  const handleMergeParticipants = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeSourceId || !mergeTargetId) {
      onShowNotification("Please specify both source and target participants to merge.", "error");
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      onShowNotification("Source and target cannot be the same participant.", "error");
      return;
    }

    try {
      const res = await fetch("/api/participants/merge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          sourceId: mergeSourceId,
          targetId: mergeTargetId
        })
      });

      if (res.ok) {
        onShowNotification("Duplicate records merged successfully! All historical allocations and payments mapped over.", "success");
        setShowMergeModal(false);
        setMergeSourceId("");
        setMergeTargetId("");
        fetchParticipants();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menggabungkan duplikat.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredParticipants = participants.filter(p => {
    const term = searchQuery.toLowerCase();
    return p.fullName.toLowerCase().includes(term) || 
           (p.nickname && p.nickname.toLowerCase().includes(term)) || 
           p.normalizedPhone.includes(term);
  });

  return (
    <div className="space-y-8">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Deduplication & Directory</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Participants_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Manage contact details, normalize Indonesian numbers, deduplicate rows, and merge active historical balances.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              setMergeSourceId("");
              setMergeTargetId("");
              setShowMergeModal(true);
            }}
            className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white font-mono font-bold uppercase tracking-widest text-[10px] px-4 py-3 transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="w-4 h-4 text-blue-400" />
            Merge Duplicates
          </button>
          <button 
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-5 py-3 transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            New Contact
          </button>
        </div>
      </div>

      {/* Searching */}
      <div className="relative bg-white/[0.02] p-5 border border-white/5 flex items-center">
        <Search className="absolute left-9 top-8.5 w-4 h-4 text-white/30" />
        <input 
          type="text"
          placeholder="Search master directory by name, nickname, or normalized phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.02] border border-white/10 rounded-none pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white placeholder:text-white/20 font-sans"
        />
      </div>

      {/* Participants List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : filteredParticipants.length === 0 ? (
        <div className="bg-white/[0.01] p-16 border border-white/5 text-center">
          <Users className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-[#F9F9F7] font-medium text-sm">No directory contact found</p>
          <p className="text-[#F9F9F7]/40 text-xs mt-1">Add a participant or link from transactions to populate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
          {filteredParticipants.map(p => (
            <div 
              key={p.id}
              className="bg-[#121214]/40 p-6 border border-white/5 hover:border-white/10 shadow-2xl transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-white text-sm flex items-center flex-wrap gap-2">
                      {p.fullName}
                      {p.nickname && p.nickname !== p.fullName && (
                        <span className="text-[10px] text-white/40 font-mono tracking-wide uppercase">({p.nickname})</span>
                      )}
                    </h3>
                    <p className="text-[9px] text-[#F9F9F7]/30 font-mono mt-1 uppercase tracking-widest">UID: {p.id.slice(0, 8)}...</p>
                  </div>

                  <span className={`text-[9px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-none shrink-0 ${
                    p.active ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/5 text-[#F9F9F7]/40 border border-white/10"
                  }`}>
                    {p.active ? "Active" : "Archived"}
                  </span>
                </div>

                <div className="space-y-2 mt-5 text-xs text-[#F9F9F7]/70">
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-3.5 h-3.5 text-[#F9F9F7]/30" />
                    <span className="font-mono">+{p.normalizedPhone}</span>
                  </div>
                  {p.email && (
                    <div className="flex items-center gap-2.5">
                      <Mail className="w-3.5 h-3.5 text-[#F9F9F7]/30" />
                      <span className="font-sans truncate text-xs">{p.email}</span>
                    </div>
                  )}
                  {p.notes && (
                    <div className="flex items-start gap-2 bg-white/[0.01] p-3 border border-white/5 mt-3 text-xs italic text-[#F9F9F7]/50 font-sans">
                      <Tag className="w-3.5 h-3.5 text-white/20 mt-0.5 shrink-0" />
                      <span>{p.notes}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-4 mt-6">
                <button 
                  onClick={() => handleOpenEditModal(p)}
                  className="px-3 py-1.5 hover:bg-white/5 border border-white/10 hover:border-white/20 text-[#F9F9F7]/80 hover:text-white text-[10px] font-mono uppercase tracking-wider font-bold flex items-center gap-1 transition-all cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
                <button 
                  onClick={() => handleDeleteParticipant(p.id)}
                  className="p-2 border border-white/10 text-[#F9F9F7]/40 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all cursor-pointer"
                  title="Remove contact"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT PARTICIPANT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white">
                {editingId ? "Edit Contact_" : "Register Contact_"}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveParticipant} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Full Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Yudhistira Budi"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">WhatsApp Phone Number *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. 081234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-mono placeholder:opacity-30"
                />
                <p className="text-[10px] text-[#F9F9F7]/30 font-mono mt-1.5 leading-relaxed">Numbers are normalized to international formatting (62...) on submission.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Nickname / Alias</label>
                  <input 
                    type="text"
                    placeholder="e.g. Yudhis"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Email Address</label>
                  <input 
                    type="email"
                    placeholder="yudhis@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Administrative Notes</label>
                <input 
                  type="text"
                  placeholder="Add context (e.g. Office peer, High School friend)..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30"
                />
              </div>

              {editingId && (
                <label className="flex items-center gap-2.5 text-xs text-[#F9F9F7]/70 cursor-pointer pt-2 font-mono">
                  <input 
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="border-white/20 bg-white/5 rounded-none text-blue-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Keep Participant Active in Directory listings</span>
                </label>
              )}

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
                  Confirm Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MERGE DUPLICATES MODAL (PAR-006) */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                Merge Profiles_
              </h3>
              <button onClick={() => setShowMergeModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleMergeParticipants} className="p-6 space-y-4">
              <div className="p-4 bg-blue-950/20 border border-blue-900/30 text-xs text-blue-300 flex gap-3">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                <div className="leading-relaxed">
                  <span className="font-bold block mb-1 uppercase tracking-wider text-[10px] font-mono">Deduplication Rule</span>
                  Merging duplicate profiles consolidates transaction history, payment declarations, and tokens. <b>Source participant</b> is deleted and merged into <b>Target participant</b>.
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Duplicate Participant (Source - TO DELETE) *</label>
                <select 
                  required
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-mono cursor-pointer"
                >
                  <option value="" className="bg-[#121214]">Select source participant...</option>
                  {participants.map(p => (
                    <option key={p.id} value={p.id} className="bg-[#121214]">{p.fullName} (+{p.normalizedPhone})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Master Participant (Target - TO KEEP) *</label>
                <select 
                  required
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-mono cursor-pointer"
                >
                  <option value="" className="bg-[#121214]">Select destination target...</option>
                  {participants.map(p => (
                    <option key={p.id} value={p.id} className="bg-[#121214]">{p.fullName} (+{p.normalizedPhone})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  onClick={() => setShowMergeModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2.5 bg-white text-black font-bold hover:bg-neutral-200 cursor-pointer"
                >
                  Execute Merge Operations
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
