import React, { useState, useEffect } from "react";
import { 
  Plus, Calendar, MoreVertical, ExternalLink, RefreshCw, Trash2, 
  Edit3, CheckCircle, Clock, Users, ArrowRight, Clipboard, MessageSquare, 
  Send, UserPlus, Info, CheckCircle2, X, AlertCircle, Eye, ArrowUpRight
} from "lucide-react";
import { Category, Participant } from "../types";

const getPublicOrigin = () => {
  return window.location.origin;
};

interface CategoriesProps {
  token: string;
  admin?: any;
  onNavigate: (path: string) => void;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Categories({ token, admin, onNavigate, onShowNotification }: CategoriesProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create / Edit Category Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<'Draft' | 'Ongoing' | 'Completed' | 'Archived'>("Draft");
  const [notes, setNotes] = useState("");

  // Details View State
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<'participants' | 'transactions'>("participants");

  // Link Participant Modal State
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [masterParticipants, setMasterParticipants] = useState<Participant[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantPhone, setNewParticipantPhone] = useState("");

  // WhatsApp Click-to-Chat preview state
  const [previewMsg, setPreviewMsg] = useState<{ pId: string; text: string; link: string; phone: string } | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal mengambil data kategori.", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchCategoryDetails = async (catId: string) => {
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/categories/${catId}/details`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDetailsData(data);
      } else {
        onShowNotification("Gagal memuat detail kategori.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Error loading details.", "error");
    } finally {
      setLoadingDetails(false);
    }
  };

  const fetchMasterParticipants = async () => {
    try {
      const res = await fetch("/api/participants", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMasterParticipants(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingCategory(null);
    setName("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    setStatus("Draft");
    setNotes("");
    setShowModal(true);
  };

  const handleOpenEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setName(cat.name);
    setDescription(cat.description);
    setStartDate(cat.startDate || "");
    setEndDate(cat.endDate || "");
    setStatus(cat.status);
    setNotes(cat.notes || "");
    setShowModal(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      onShowNotification("Category name is required.", "error");
      return;
    }

    try {
      const url = editingCategory ? `/api/categories/${editingCategory.id}` : "/api/categories";
      const method = editingCategory ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name, description, startDate, endDate, status, notes })
      });

      if (res.ok) {
        onShowNotification(editingCategory ? "Category updated successfully!" : "Category created successfully!", "success");
        setShowModal(false);
        fetchCategories();
        if (selectedCategoryId) {
          fetchCategoryDetails(selectedCategoryId);
        }
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menyimpan kategori.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan saat menyimpan kategori.", "error");
    }
  };

  const handleDeleteCategory = async (catId: string, force = false) => {
    if (!force && !confirm("Are you sure you want to delete this Category? All dependent transactions and participant mappings will be removed permanently. This action cannot be undone.")) {
      return;
    }

    try {
      const res = await fetch(`/api/categories/${catId}${force ? "?force=true" : ""}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Category deleted successfully.", "success");
        setSelectedCategoryId(null);
        setDetailsData(null);
        fetchCategories();
      } else {
        const err = await res.json();
        if (res.status === 400 && err.canForce) {
          if (confirm(`${err.error}\n\nDo you want to FORCE CASCADE DELETE? This will permanently remove all transactions and payment records linked to this category as well. WARNING: This action cannot be undone.`)) {
            handleDeleteCategory(catId, true);
            return;
          }
        }
        onShowNotification(err.error || "Gagal menghapus kategori.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Error deleting category.", "error");
    }
  };

  const handleOpenLinkModal = () => {
    fetchMasterParticipants();
    setSelectedParticipantIds([]);
    setNewParticipantName("");
    setNewParticipantPhone("");
    setShowLinkModal(true);
  };

  const handleLinkParticipants = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategoryId) return;

    const payload: any = {
      participantIds: selectedParticipantIds
    };

    if (newParticipantName && newParticipantPhone) {
      payload.newParticipants = [
        { fullName: newParticipantName, phone: newParticipantPhone }
      ];
    }

    try {
      const res = await fetch(`/api/categories/${selectedCategoryId}/participants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        onShowNotification("Participants mapped successfully!", "success");
        setShowLinkModal(false);
        fetchCategoryDetails(selectedCategoryId);
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menautkan peserta.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan.", "error");
    }
  };

  // Regenerate secure Personal Payment Token (PPL-002)
  const handleRegenerateToken = async (pId: string) => {
    if (!selectedCategoryId) return;
    if (!confirm("Are you sure you want to revoke the existing Personal Payment Link and generate a new one? The old link will stop working instantly.")) {
      return;
    }

    try {
      const res = await fetch(`/api/categories/${selectedCategoryId}/participants/${pId}/regenerate-token`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        onShowNotification("Payment link revoked and regenerated!", "success");
        fetchCategoryDetails(selectedCategoryId);
      } else {
        onShowNotification("Gagal membuat ulang token.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Pre-fill and trigger Click-to-Chat reminder & introduction messages (Section 5.2 / 13)
  const replacePlaceholders = (template: string, p: any, category: any, payLink: string) => {
    let text = template;
    const remainingBalance = p.totals.remaining;
    text = text.replace(/\{\{participant_name\}\}/g, p.fullName);
    text = text.replace(/\{\{category_name\}\}/g, category.name);
    text = text.replace(/\{\{remaining_amount\}\}/g, formatIDR(remainingBalance));
    text = text.replace(/\{\{payment_link\}\}/g, payLink);
    text = text.replace(/\{\{admin_name\}\}/g, admin?.displayName || "Admin");
    return text;
  };

  const triggerIntroductionMessage = (p: any) => {
    if (!detailsData) return;
    const { category } = detailsData;
    const payLink = `${getPublicOrigin()}/pay/${p.personalToken}`;
    
    const template = admin?.settings?.introductionTemplate || 
      "Thank you. Your name has been registered in Yeb’s Smart Split Bill. Any split bill involving {{participant_name}} will be integrated into Smart Split Bill. Here is your authentic personal link: {{payment_link}}";
    
    const text = replacePlaceholders(template, p, category, payLink);
    
    setPreviewMsg({
      pId: p.id,
      text,
      link: payLink,
      phone: p.normalizedPhone
    });
  };

  const triggerReminderMessage = (p: any) => {
    if (!detailsData) return;
    const { category } = detailsData;
    const payLink = `${getPublicOrigin()}/pay/${p.personalToken}`;
    
    const template = admin?.settings?.reminderTemplate || 
      "Hello, {{participant_name}}\nThis is a reminder regarding your outstanding balance for {{category_name}}.\n\nRemaining balance: {{remaining_amount}}\n\nPlease open your Personal Payment Link to review the details and complete payment:\n{{payment_link}}\n\nThank you, {{admin_name}}.";
    
    const text = replacePlaceholders(template, p, category, payLink);

    setPreviewMsg({
      pId: p.id,
      text,
      link: payLink,
      phone: p.normalizedPhone
    });
  };

  // Send message webhook tracking Click-to-Chat opened (WA-005)
  const confirmSendMessage = async (action: "whatsapp_opened" | "sent") => {
    if (!previewMsg || !selectedCategoryId) return;
    try {
      await fetch("/api/public/message-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: previewMsg.pId,
          categoryId: selectedCategoryId,
          type: "introduction",
          generatedMessage: previewMsg.text,
          link: previewMsg.link,
          action
        })
      });

      if (action === "whatsapp_opened") {
        // Open actual WhatsApp Click-to-Chat URL (WA-004)
        const encoded = encodeURIComponent(previewMsg.text);
        const url = `https://wa.me/${previewMsg.phone}?text=${encoded}`;
        try {
          window.open(url, "_blank");
        } catch (e) {
          console.warn("window.open blocked, attempting anchor link click fallback", e);
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } else {
        onShowNotification("Marked manually as sent.", "success");
      }

      setPreviewMsg(null);
      if (selectedCategoryId) {
        fetchCategoryDetails(selectedCategoryId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="space-y-8">
      {/* Page Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Category Organizer / Workspace</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Categories_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Organize bills into categories (projects), map participants, view obligation summaries, and share payment portals.
          </p>
        </div>
        <button 
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-5 py-3 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Category
        </button>
      </div>

      {/* Main Grid: Categories List (Left) and Details Panel (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Categories List */}
        <div className="space-y-4 lg:col-span-1">
          <h2 className="text-[10px] font-mono font-bold text-[#F9F9F7]/40 uppercase tracking-widest">Available Containers ({categories.length})</h2>
          
          {loading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
            </div>
          ) : categories.length === 0 ? (
            <div className="bg-white/[0.02] border border-white/5 p-8 text-center">
              <Info className="w-6 h-6 text-white/20 mx-auto mb-3" />
              <p className="text-[#F9F9F7] text-sm font-medium">No Categories Created</p>
              <p className="text-[#F9F9F7]/40 text-xs mt-1">Add a new category to begin organizing transactions.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {categories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id;
                let statusBadge = "border-white/10 text-[#F9F9F7]/50 bg-white/5";
                if (cat.status === "Ongoing") statusBadge = "border-emerald-500/20 text-emerald-400 bg-emerald-500/5";
                if (cat.status === "Completed") statusBadge = "border-blue-500/20 text-blue-400 bg-blue-500/5";
                if (cat.status === "Archived") statusBadge = "border-rose-500/20 text-rose-400 bg-rose-500/5";

                return (
                  <div 
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      fetchCategoryDetails(cat.id);
                    }}
                    className={`p-5 border transition-all cursor-pointer text-left ${
                      isSelected 
                        ? "border-blue-500 bg-blue-500/[0.02]" 
                        : "border-white/5 bg-white/[0.01] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold text-white text-sm block">{cat.name}</span>
                      <span className={`text-[9px] font-mono font-semibold px-2 py-0.5 border uppercase tracking-wider ${statusBadge}`}>{cat.status}</span>
                    </div>
                    
                    <p className="text-xs text-[#F9F9F7]/50 mt-2 line-clamp-2 leading-relaxed">{cat.description || "No description provided."}</p>
                    
                    <div className="flex items-center gap-3 text-[10px] text-[#F9F9F7]/30 font-mono mt-4 border-t border-white/5 pt-3">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Start: {cat.startDate || "N/A"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Details Panel */}
        <div className="lg:col-span-2">
          {!selectedCategoryId ? (
            <div className="bg-white/[0.01] border border-dashed border-white/10 flex flex-col items-center justify-center py-24 text-center">
              <Eye className="w-8 h-8 text-white/20 mb-3 animate-pulse" />
              <p className="text-[#F9F9F7] font-medium text-sm">Select a category from the list to view billing breakdowns.</p>
              <p className="text-[#F9F9F7]/40 text-xs mt-1">Manage members, view invoices, generate secure links, and run reminders.</p>
            </div>
          ) : loadingDetails || !detailsData ? (
            <div className="bg-white/[0.02] border border-white/5 p-12 flex flex-col items-center justify-center min-h-[40vh] text-center">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mb-3" />
              <p className="text-[#F9F9F7]/50 text-xs font-mono uppercase tracking-widest">Loading dynamic allocations summary...</p>
            </div>
          ) : (
            <div className="bg-white/[0.02] border border-white/5 overflow-hidden text-left shadow-2xl">
              
              {/* Category Header Controls */}
              <div className="p-6 bg-white/[0.02] border-b border-white/5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-white">{detailsData.category.name}</h2>
                    <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 border uppercase tracking-wider ${
                      detailsData.category.status === "Ongoing" ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/5" :
                      detailsData.category.status === "Completed" ? "border-blue-500/20 text-blue-400 bg-blue-500/5" : "border-white/10 text-white/50 bg-white/5"
                    }`}>{detailsData.category.status}</span>
                  </div>
                  <p className="text-xs text-[#F9F9F7]/50 mt-1.5">{detailsData.category.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleOpenEditModal(detailsData.category)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[#F9F9F7] text-[10px] font-mono uppercase tracking-widest transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-blue-400" />
                    Edit
                  </button>
                  <button 
                    onClick={() => handleDeleteCategory(detailsData.category.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-mono uppercase tracking-widest transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>

              {/* Category Totals Banner */}
              <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6 border-b border-white/5 bg-[#121214]/40">
                <div>
                  <span className="text-[9px] font-mono text-[#F9F9F7]/40 uppercase tracking-widest block font-bold">Total Spent</span>
                  <span className="text-lg font-bold text-white mt-1 block font-sans">{formatIDR(detailsData.totals.totalSpent)}</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-[#F9F9F7]/40 uppercase tracking-widest block font-bold">Verified Received</span>
                  <span className="text-lg font-bold text-emerald-400 mt-1 block font-sans">{formatIDR(detailsData.totals.verifiedPaid)}</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-[#F9F9F7]/40 uppercase tracking-widest block font-bold">Outstanding</span>
                  <span className="text-lg font-bold text-rose-400 mt-1 block font-sans">{formatIDR(detailsData.totals.outstanding)}</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-[#F9F9F7]/40 uppercase tracking-widest block font-bold">Pending Proofs</span>
                  <span className="text-lg font-bold text-amber-400 mt-1 block font-sans">{formatIDR(detailsData.totals.pendingPaid)}</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="px-6 py-4 bg-white/[0.01] border-b border-white/5 flex items-center justify-between text-xs text-[#F9F9F7]/60 gap-4 font-mono text-[11px] uppercase tracking-wider">
                <span>Verification & Collection progress</span>
                <div className="flex items-center gap-3 flex-1 max-w-[200px]">
                  <div className="w-full bg-white/5 h-1">
                    <div 
                      className="bg-blue-500 h-1" 
                      style={{ width: `${detailsData.totals.totalSpent > 0 ? Math.round((detailsData.totals.verifiedPaid / detailsData.totals.totalSpent) * 100) : 0}%` }} 
                    />
                  </div>
                  <span className="font-bold text-blue-400">
                    {detailsData.totals.totalSpent > 0 ? Math.round((detailsData.totals.verifiedPaid / detailsData.totals.totalSpent) * 100) : 0}%
                  </span>
                </div>
              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-white/5 bg-black/20">
                <button 
                  onClick={() => setActiveTab("participants")}
                  className={`px-6 py-4 font-bold text-[10px] font-mono uppercase tracking-widest transition-all cursor-pointer border-b ${
                    activeTab === "participants" ? "border-blue-500 text-blue-400 bg-white/[0.01]" : "border-transparent text-[#F9F9F7]/40 hover:text-[#F9F9F7]"
                  }`}
                >
                  Participants ({detailsData.participants.length})
                </button>
                <button 
                  onClick={() => setActiveTab("transactions")}
                  className={`px-6 py-4 font-bold text-[10px] font-mono uppercase tracking-widest transition-all cursor-pointer border-b ${
                    activeTab === "transactions" ? "border-blue-500 text-blue-400 bg-white/[0.01]" : "border-transparent text-[#F9F9F7]/40 hover:text-[#F9F9F7]"
                  }`}
                >
                  Transactions ({detailsData.transactions.length})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                
                {/* 1. PARTICIPANTS TAB */}
                {activeTab === "participants" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-mono font-semibold text-[#F9F9F7]/40 uppercase tracking-widest">Mapped Members & Payment Portals</h4>
                      <button 
                        onClick={handleOpenLinkModal}
                        className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 transition-all cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-blue-400" />
                        Map Member
                      </button>
                    </div>

                    {detailsData.participants.length === 0 ? (
                      <div className="text-center py-12 bg-white/[0.01] border border-dashed border-white/10">
                        <Users className="w-6 h-6 text-white/20 mx-auto mb-2" />
                        <p className="text-xs font-mono text-[#F9F9F7]/40 uppercase tracking-wider">No members mapped to this category yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5 border border-white/5 bg-[#121214]/60">
                        {detailsData.participants.map((p: any) => {
                          const payLink = `${getPublicOrigin()}/pay/${p.personalToken}`;
                          const isFullyPaid = p.totals.remaining === 0 && p.totals.totalOriginalObligation > 0;

                          return (
                            <div key={p.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.02]">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-white text-sm">{p.fullName}</span>
                                  {isFullyPaid && (
                                    <span className="text-[9px] font-mono uppercase tracking-wider font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3" />
                                      Settled
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#F9F9F7]/50 mt-1.5 font-mono">
                                  <span>+{p.normalizedPhone}</span>
                                  <span>Due: {formatIDR(p.totals.totalOriginalObligation)}</span>
                                  <span className="text-emerald-400">Paid: {formatIDR(p.totals.paid)}</span>
                                  <span className="text-rose-400 font-semibold">Remaining: {formatIDR(p.totals.remaining)}</span>
                                </div>
                              </div>

                              {/* Interactive Actions (PPL Portal & WA Reminders) */}
                              <div className="flex items-center gap-2 font-mono">
                                {/* Copy Personal Link */}
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(payLink);
                                    onShowNotification("Personal payment portal link copied to clipboard!", "success");
                                  }}
                                  className="p-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-white cursor-pointer"
                                  title="Copy secure payment portal link"
                                >
                                  <Clipboard className="w-3.5 h-3.5" />
                                </button>

                                {/* Revoke / Regenerate Link */}
                                <button 
                                  onClick={() => handleRegenerateToken(p.id)}
                                  className="p-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-white hover:text-rose-400 cursor-pointer"
                                  title="Revoke and regenerate link token"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>

                                {/* Click-to-Chat Triggers (Section 5.2/13) */}
                                <button 
                                  onClick={() => triggerIntroductionMessage(p)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                                  title="WhatsApp introduction welcome message"
                                >
                                  <Send className="w-3 h-3" />
                                  Intro
                                </button>

                                {!isFullyPaid && (
                                  <button 
                                    onClick={() => triggerReminderMessage(p)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/15 border border-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                                    title="WhatsApp Click-to-Chat unpaid balance reminder"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    Remind
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. TRANSACTIONS TAB */}
                {activeTab === "transactions" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-mono font-semibold text-[#F9F9F7]/40 uppercase tracking-widest">Expenses Linked to Category</h4>
                      <button 
                        onClick={() => onNavigate("/app/transactions")}
                        className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-blue-400" />
                        New Bill Entry
                      </button>
                    </div>

                    {detailsData.transactions.length === 0 ? (
                      <div className="text-center py-12 bg-white/[0.01] border border-dashed border-white/10">
                        <Info className="w-6 h-6 text-white/20 mx-auto mb-2" />
                        <p className="text-xs font-mono text-[#F9F9F7]/40 uppercase tracking-wider">No transactions recorded for this category.</p>
                      </div>
                    ) : (
                      <div className="border border-white/5 bg-[#121214]/60 divide-y divide-white/5">
                        {detailsData.transactions.map((t: any) => (
                          <div key={t.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
                            <div>
                              <span className="font-semibold text-white text-sm block">{t.title}</span>
                              <span className="text-xs text-[#F9F9F7]/50 font-mono block mt-1">
                                Date: {t.date} | Merchant: {t.merchant} | Classification: {t.expenseClassification}
                              </span>
                            </div>
                            <div className="text-right font-mono">
                              <span className="font-bold text-[#F9F9F7] text-sm block">{formatIDR(t.total)}</span>
                              <button 
                                onClick={() => onNavigate("/app/transactions")}
                                className="text-[10px] text-blue-400 hover:underline font-semibold mt-1 uppercase tracking-wider block"
                              >
                                View Allocations &rarr;
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>

            </div>
          )}
        </div>

      </div>

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-lg overflow-hidden text-left shadow-2xl relative">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white">
                {editingCategory ? "Modify Container_" : "Create Container_"}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Category Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Trip Bandung, Office Dinner, Committe Event"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Description</label>
                <textarea 
                  placeholder="Summarize the core purpose of expense splitting container..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30 h-20 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Start Date</label>
                  <input 
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">End Date</label>
                  <input 
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-mono"
                  />
                </div>
              </div>

              {editingCategory && (
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Status</label>
                  <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-white font-mono cursor-pointer"
                  >
                    <option value="Draft" className="bg-[#121214]">Draft</option>
                    <option value="Ongoing" className="bg-[#121214]">Ongoing</option>
                    <option value="Completed" className="bg-[#121214]">Completed</option>
                    <option value="Archived" className="bg-[#121214]">Archived</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Notes (Internal Admin)</label>
                <input 
                  type="text"
                  placeholder="Optional billing reminders, rules, custom methods..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                />
              </div>

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
                  {editingCategory ? "Save Changes" : "Create Container"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LINK PARTICIPANT MODAL */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-lg overflow-hidden text-left shadow-2xl relative">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white">Map Members_</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLinkParticipants} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              
              {/* Option 1: Select existing */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">
                  Select Existing From Master Directory
                </label>
                <div className="border border-white/10 bg-white/[0.01] p-4 max-h-40 overflow-y-auto space-y-2">
                  {masterParticipants.length === 0 ? (
                    <p className="text-xs text-[#F9F9F7]/40 font-mono italic">No master directory participants found. Create one inline below.</p>
                  ) : (
                    masterParticipants.map(mp => {
                      const isChecked = selectedParticipantIds.includes(mp.id);
                      return (
                        <label key={mp.id} className="flex items-center gap-2.5 text-xs text-[#F9F9F7]/70 cursor-pointer hover:text-white font-medium">
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSelectedParticipantIds(selectedParticipantIds.filter(id => id !== mp.id));
                              } else {
                                setSelectedParticipantIds([...selectedParticipantIds, mp.id]);
                              }
                            }}
                            className="border-white/20 bg-white/5 rounded-none text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="font-sans">{mp.fullName} <span className="font-mono text-[10px] text-white/40">(+{mp.normalizedPhone})</span></span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-white/5" />
                <span className="flex-shrink mx-4 text-white/30 font-mono text-[9px] font-bold uppercase tracking-[0.2em]">OR CREATE INLINE</span>
                <div className="flex-grow border-t border-white/5" />
              </div>

              {/* Option 2: Add inline */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Full Name</label>
                  <input 
                    type="text"
                    placeholder="Enter full name of participant..."
                    value={newParticipantName}
                    onChange={(e) => setNewParticipantName(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">WhatsApp / Phone Number</label>
                  <input 
                    type="text"
                    placeholder="e.g. 081234567890"
                    value={newParticipantPhone}
                    onChange={(e) => setNewParticipantPhone(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-mono placeholder:opacity-30"
                  />
                  <p className="text-[10px] text-[#F9F9F7]/30 mt-1.5 font-mono">Automatic Indonesian country-code formatting (starts with 62) applies on save.</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2.5 bg-white text-black font-bold hover:bg-neutral-200 cursor-pointer"
                >
                  Confirm Mapping
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WHATSAPP CLICK-TO-CHAT PREVIEW MODAL */}
      {previewMsg && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl relative">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white flex items-center gap-2.5">
                <MessageSquare className="w-5 h-5 text-emerald-400" />
                WhatsApp dispatch_
              </h3>
              <button onClick={() => setPreviewMsg(null)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-white/[0.01] border border-white/10 font-mono">
                <span className="text-[9px] font-bold text-[#F9F9F7]/40 block mb-1 uppercase tracking-widest">Receiver Target Phone:</span>
                <span className="font-semibold text-sm text-white">+{previewMsg.phone}</span>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Pre-filled Message Content</label>
                <textarea 
                  readOnly
                  value={previewMsg.text}
                  className="w-full bg-white/[0.02] border border-white/10 rounded-none p-4 text-xs font-mono h-40 focus:outline-none text-[#F9F9F7]"
                />
              </div>

              <div className="p-3.5 bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300 flex gap-2.5 font-mono">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                <p className="leading-relaxed text-[11px]">Click-to-Chat reminder node. Opening WhatsApp will pre-fill this text dispatch inside your chat app, logging trace metadata inside the audit trail.</p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button"
                  onClick={() => confirmSendMessage("sent")}
                  className="px-3.5 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Mark Manual Sent
                </button>
                <button 
                  type="button" 
                  onClick={() => confirmSendMessage("whatsapp_opened")}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Dispatch
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
