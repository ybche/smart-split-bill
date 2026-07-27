import React, { useState, useEffect } from "react";
import { 
  Settings as SettingsIcon, MessageSquare, Users, Plus, Trash2, Edit, 
  Shield, CheckCircle2, X, Key, RefreshCw, AlertCircle, Info, ToggleLeft, ToggleRight,
  Database, Download, Upload
} from "lucide-react";

interface SettingsProps {
  token: string;
  admin: any;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Settings({ token, admin, onShowNotification }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<"templates" | "admins" | "backup">("templates");

  // Backup / restore state
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // Message templates state
  const [introTemplate, setIntroTemplate] = useState("");
  const [reminderTemplate, setReminderTemplate] = useState("");
  const [requireProof, setRequireProof] = useState(true);
  const [savingTemplates, setSavingTemplates] = useState(false);

  // Admins list state
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  
  // Admin form state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminActive, setAdminActive] = useState(true);
  const [savingAdmin, setSavingAdmin] = useState(false);

  useEffect(() => {
    if (admin && admin.settings) {
      setIntroTemplate(admin.settings.introductionTemplate || "");
      setReminderTemplate(admin.settings.reminderTemplate || "");
      setRequireProof(admin.settings.requireProof ?? true);
    }
  }, [admin]);

  const fetchAdmins = async () => {
    setLoadingAdmins(true);
    try {
      const res = await fetch("/api/admins", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setAdminsList(await res.json());
      } else {
        onShowNotification("Gagal mengambil data administrator.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan saat mengambil data administrator.", "error");
    } finally {
      setLoadingAdmins(false);
    }
  };

  useEffect(() => {
    if (activeTab === "admins") {
      fetchAdmins();
    }
  }, [activeTab]);

  const handleSaveTemplates = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTemplates(true);
    try {
      const res = await fetch("/api/auth/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          settings: {
            introductionTemplate: introTemplate,
            reminderTemplate: reminderTemplate,
            requireProof
          }
        })
      });

      if (res.ok) {
        onShowNotification("Message templates saved successfully!", "success");
        // Reload page or let parent component update
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menyimpan template pesan.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat menyimpan template.", "error");
    } finally {
      setSavingTemplates(false);
    }
  };

  const handleOpenAddAdmin = () => {
    setEditingAdminId(null);
    setAdminDisplayName("");
    setAdminUsername("");
    setAdminPassword("");
    setAdminActive(true);
    setShowAdminModal(true);
  };

  const handleOpenEditAdmin = (a: any) => {
    setEditingAdminId(a.id);
    setAdminDisplayName(a.displayName);
    setAdminUsername(a.email);
    setAdminPassword("");
    setAdminActive(a.active !== false);
    setShowAdminModal(true);
  };

  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminDisplayName || !adminUsername || (!editingAdminId && !adminPassword)) {
      onShowNotification("Please fill in all required fields.", "error");
      return;
    }

    setSavingAdmin(true);
    try {
      const url = editingAdminId ? `/api/admins/${editingAdminId}` : "/api/admins";
      const method = editingAdminId ? "PUT" : "POST";
      const payload: any = {
        displayName: adminDisplayName,
        email: adminUsername,
        active: adminActive
      };
      if (adminPassword) {
        payload.password = adminPassword;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        onShowNotification(
          editingAdminId ? "Administrator updated successfully." : "New administrator created.",
          "success"
        );
        setShowAdminModal(false);
        fetchAdmins();
        // If updating oneself, reload is good to reflect displayName changes
        if (editingAdminId === admin.id) {
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menyimpan administrator.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat menyimpan administrator.", "error");
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (id: string, name: string) => {
    if (id === admin.id) {
      onShowNotification("Cannot delete your own active session account.", "error");
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete administrator "${name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admins/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Administrator removed.", "success");
        fetchAdmins();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menghapus administrator.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan saat menghapus administrator.", "error");
    }
  };

  // Live Template Previews helper
  const renderTemplatePreview = (tpl: string, isIntro: boolean) => {
    if (!tpl) return <span className="text-white/20 italic">No template configured yet.</span>;
    let result = tpl;
    result = result.replace(/\{\{participant_name\}\}/g, "Budi");
    result = result.replace(/\{\{category_name\}\}/g, "Trip Bandung");
    result = result.replace(/\{\{remaining_amount\}\}/g, "Rp750.000");
    result = result.replace(/\{\{payment_link\}\}/g, "https://split.yeb.id/pay/token123");
    result = result.replace(/\{\{admin_name\}\}/g, admin?.displayName || "Admin");
    return result;
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">System configuration</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Settings_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Manage your notification message templates and configure workspace administrators.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex flex-wrap border border-white/10 p-1 bg-[#121214]/50">
          <button
            onClick={() => setActiveTab("templates")}
            className={`flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-wider font-bold transition-colors cursor-pointer ${
              activeTab === "templates" ? "bg-white text-black" : "text-[#F9F9F7]/50 hover:text-white"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Message Templates
          </button>
          <button
            onClick={() => setActiveTab("admins")}
            className={`flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-wider font-bold transition-colors cursor-pointer ${
              activeTab === "admins" ? "bg-white text-black" : "text-[#F9F9F7]/50 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Administrators
          </button>
          <button
            onClick={() => setActiveTab("backup")}
            className={`flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-wider font-bold transition-colors cursor-pointer ${
              activeTab === "backup" ? "bg-white text-black" : "text-[#F9F9F7]/50 hover:text-white"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Backup & Restore
          </button>
        </div>
      </div>

      {/* Tab Contents: Templates */}
      {activeTab === "templates" && (
        <form onSubmit={handleSaveTemplates} className="space-y-6 max-w-4xl text-left">
          {/* Dynamic Placeholder Guide */}
          <div className="bg-[#121214]/40 border border-white/5 p-6 space-y-3.5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
              <Info className="w-4 h-4 text-blue-400" />
              DYNAMIC PLACEHOLDERS GUIDE
            </h3>
            <p className="text-xs text-[#F9F9F7]/50 leading-relaxed">
              Use these template placeholders in your introduction and reminder text. The system automatically populates actual database records when sending WhatsApp Click-to-Chat alerts.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-[10px] pt-2">
              <div className="bg-white/[0.02] border border-white/5 p-3 rounded-none">
                <code className="text-blue-400 font-bold block mb-1">{"{{participant_name}}"}</code>
                <span className="text-white/40">Recipient's registered name</span>
              </div>
              <div className="bg-white/[0.02] border border-white/5 p-3 rounded-none">
                <code className="text-blue-400 font-bold block mb-1">{"{{category_name}}"}</code>
                <span className="text-white/40">Category / Event name</span>
              </div>
              <div className="bg-white/[0.02] border border-white/5 p-3 rounded-none">
                <code className="text-blue-400 font-bold block mb-1">{"{{remaining_amount}}"}</code>
                <span className="text-white/40">Total outstanding balance</span>
              </div>
              <div className="bg-white/[0.02] border border-white/5 p-3 rounded-none">
                <code className="text-blue-400 font-bold block mb-1">{"{{payment_link}}"}</code>
                <span className="text-white/40">Recipient's payment link</span>
              </div>
              <div className="bg-white/[0.02] border border-white/5 p-3 rounded-none">
                <code className="text-blue-400 font-bold block mb-1">{"{{admin_name}}"}</code>
                <span className="text-white/40">Your Administrator Display Name</span>
              </div>
            </div>
          </div>

          {/* Portal Peserta General Settings */}
          <div className="bg-[#121214]/40 border border-white/5 p-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-white font-mono">Wajib Lampirkan Bukti Transfer</h3>
              <p className="text-xs text-[#F9F9F7]/50 leading-relaxed mt-1">
                Jika aktif, peserta wajib mengunggah foto bukti transfer sebelum bisa mengirim deklarasi pembayaran di Portal Peserta.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRequireProof(!requireProof)}
              className="flex items-center text-white/80 hover:text-white cursor-pointer shrink-0"
            >
              {requireProof ? (
                <div className="flex items-center gap-2 text-emerald-400">
                  <ToggleRight className="w-8 h-8" />
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Wajib</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/40">
                  <ToggleLeft className="w-8 h-8" />
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Opsional</span>
                </div>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Introduction Message */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono uppercase tracking-widest font-bold text-white/70">Introduction Message Template</label>
              </div>
              <textarea
                value={introTemplate}
                onChange={(e) => setIntroTemplate(e.target.value)}
                rows={7}
                placeholder="Write your greeting introduction template..."
                className="w-full bg-white/[0.02] border border-white/10 rounded-none p-4 text-xs font-mono text-white focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
              />
              <div className="bg-[#0D0D0F]/40 border border-white/5 p-4 space-y-2">
                <span className="text-[9px] font-mono uppercase tracking-widest text-blue-400 font-bold">Live Preview:</span>
                <p className="text-[11px] text-[#F9F9F7]/70 font-mono whitespace-pre-wrap leading-relaxed bg-[#0D0D0F]/30 p-3 border border-white/[0.02]">
                  {renderTemplatePreview(introTemplate, true)}
                </p>
              </div>
            </div>

            {/* Reminder Message */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono uppercase tracking-widest font-bold text-white/70">Reminder Message Template</label>
              </div>
              <textarea
                value={reminderTemplate}
                onChange={(e) => setReminderTemplate(e.target.value)}
                rows={7}
                placeholder="Write your balance reminder template..."
                className="w-full bg-white/[0.02] border border-white/10 rounded-none p-4 text-xs font-mono text-white focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
              />
              <div className="bg-[#0D0D0F]/40 border border-white/5 p-4 space-y-2">
                <span className="text-[9px] font-mono uppercase tracking-widest text-blue-400 font-bold">Live Preview:</span>
                <p className="text-[11px] text-[#F9F9F7]/70 font-mono whitespace-pre-wrap leading-relaxed bg-[#0D0D0F]/30 p-3 border border-white/[0.02]">
                  {renderTemplatePreview(reminderTemplate, false)}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-6 flex justify-end">
            <button
              type="submit"
              disabled={savingTemplates}
              className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-6 py-3.5 transition-colors cursor-pointer"
            >
              {savingTemplates ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save Settings & Templates"}
            </button>
          </div>
        </form>
      )}

      {/* Tab Contents: Administrators */}
      {activeTab === "admins" && (
        <div className="space-y-6 text-left">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60 font-bold">Active Workspace Administrators</h3>
            <button
              onClick={handleOpenAddAdmin}
              className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-4 py-2.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Administrator
            </button>
          </div>

          {loadingAdmins ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : adminsList.length === 0 ? (
            <div className="bg-white/[0.01] p-12 border border-white/5 text-center">
              <Shield className="w-8 h-8 text-white/20 mx-auto mb-2" />
              <p className="text-white/60 text-xs font-mono">No Administrators Configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-white/5 bg-[#121214]/20">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[#F9F9F7]/40 uppercase tracking-widest font-mono text-[9px] font-bold">
                    <th className="py-4 px-6">Administrator Name</th>
                    <th className="py-4 px-6">Username / Email</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6">Created At</th>
                    <th className="py-4 px-6">Last Login</th>
                    <th className="py-4 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {adminsList.map(a => (
                    <tr key={a.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="py-4 px-6 font-semibold text-white flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-blue-400" />
                        {a.displayName}
                        {a.id === admin.id && <span className="text-[8px] font-mono bg-blue-500/10 text-blue-400 px-1.5 py-0.5 border border-blue-500/20 uppercase font-bold">You</span>}
                      </td>
                      <td className="py-4 px-6 font-mono text-[#F9F9F7]/70">{a.email}</td>
                      <td className="py-4 px-6">
                        <span className={`px-2 py-0.5 rounded-none text-[9px] font-mono font-bold border ${
                          a.active !== false 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 uppercase" 
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20 uppercase"
                        }`}>
                          {a.active !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-[#F9F9F7]/50 font-mono text-[10px]">
                        {new Date(a.createdAt).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                      </td>
                      <td className="py-4 px-6 text-[#F9F9F7]/50 font-mono text-[10px]">
                        {a.lastLogin 
                          ? new Date(a.lastLogin).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
                          : <span className="text-white/20 italic">Never</span>
                        }
                      </td>
                      <td className="py-4 px-6 text-right space-x-2">
                        <button
                          onClick={() => handleOpenEditAdmin(a)}
                          className="px-2.5 py-1 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white font-mono text-[10px] font-bold uppercase transition-all cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteAdmin(a.id, a.displayName)}
                          disabled={a.id === admin.id}
                          className={`px-2.5 py-1 border font-mono text-[10px] font-bold uppercase transition-all cursor-pointer ${
                            a.id === admin.id
                              ? "opacity-30 border-white/5 text-white/30 cursor-not-allowed"
                              : "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-400 hover:text-rose-300"
                          }`}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin Creator/Editor Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121214] border border-white/10 w-full max-w-md overflow-hidden text-left shadow-2xl">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="editorial-title italic text-2xl text-white">
                {editingAdminId ? "Edit Admin_" : "Add Admin_"}
              </h3>
              <button onClick={() => setShowAdminModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdmin} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Display Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Yudhis"
                  value={adminDisplayName}
                  onChange={(e) => setAdminDisplayName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-sans placeholder:opacity-30"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Username *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. yudhis"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-sans placeholder:opacity-30"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50">
                    Password {editingAdminId ? "(Optional)" : "*"}
                  </label>
                </div>
                <input 
                  type="password"
                  required={!editingAdminId}
                  placeholder={editingAdminId ? "Leave blank to keep unchanged" : "Set secret password"}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white font-sans placeholder:opacity-30"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50">Administrator Status</span>
                <button
                  type="button"
                  onClick={() => setAdminActive(!adminActive)}
                  className="flex items-center text-white/80 hover:text-white cursor-pointer"
                >
                  {adminActive ? (
                    <div className="flex items-center gap-2 text-emerald-400">
                      <ToggleRight className="w-8 h-8" />
                      <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Active</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-rose-400">
                      <ToggleLeft className="w-8 h-8" />
                      <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Inactive</span>
                    </div>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  onClick={() => setShowAdminModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={savingAdmin}
                  className="px-4 py-2.5 bg-white text-black font-bold hover:bg-neutral-200 cursor-pointer flex items-center gap-1"
                >
                  {savingAdmin && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab Contents: Backup & Restore */}
      {activeTab === "backup" && (
        <div className="space-y-6 max-w-4xl text-left font-sans">
          <div className="bg-[#121214]/40 border border-white/5 p-6 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
              <Database className="w-4 h-4 text-blue-400" />
              BACKUP & RESTORE UTILITIES (ANTI DATA LOSS)
            </h3>
            <p className="text-xs text-[#F9F9F7]/50 leading-relaxed">
              Karena server dijalankan menggunakan Cloud Run kontainer yang bersifat sementara (stateless), data yang disimpan secara lokal akan terhapus secara otomatis setiap kali sistem melakukan pembaruan (Republish). 
            </p>
            <p className="text-xs text-[#F9F9F7]/50 leading-relaxed">
              Untuk mengamankan data Anda selama fase pengembangan ini, gunakan alat pencadangan di bawah ini untuk mengekspor database sebelum melakukan rilis, dan mengimpornya kembali setelah sistem berhasil diperbarui.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
              {/* Export Panel */}
              <div className="bg-white/[0.02] border border-white/5 p-5 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-2 font-mono">Ekspor Database (Backup)</h4>
                  <p className="text-[11px] text-[#F9F9F7]/40 leading-relaxed mb-4">
                    Unduh salinan lengkap database Anda saat ini (meliputi daftar peserta, tagihan, transaksi, metode pembayaran, dll.) sebagai file cadangan JSON yang aman.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const res = await fetch("/api/db/export", {
                        headers: { "Authorization": `Bearer ${token}` }
                      });
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `smart_split_bill_backup_${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        onShowNotification("Cadangan berhasil diekspor dan diunduh!", "success");
                      } else {
                        onShowNotification("Gagal melakukan ekspor database.", "error");
                      }
                    } catch (err) {
                      onShowNotification("Terjadi kesalahan jaringan saat mengekspor.", "error");
                    } finally {
                      setExporting(false);
                    }
                  }}
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 border border-blue-500/30 hover:border-blue-500 bg-blue-500/10 hover:bg-blue-500 text-white font-mono text-[10px] uppercase font-bold py-3 px-4 transition-all duration-150 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exporting ? "Mengekspor..." : "Ekspor Database (.JSON)"}
                </button>
              </div>

              {/* Import Panel */}
              <div className="bg-white/[0.02] border border-white/5 p-5 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-2 font-mono">Impor Database (Restore)</h4>
                  <p className="text-[11px] text-[#F9F9F7]/40 leading-relaxed mb-4">
                    Unggah file cadangan JSON yang telah Anda unduh sebelumnya untuk memulihkan seluruh data dan konfigurasi secara instan.
                  </p>
                </div>
                <div className="space-y-3">
                  <input
                    type="file"
                    accept=".json"
                    id="db-backup-file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      if (!confirm("Apakah Anda yakin ingin menimpa database saat ini dengan cadangan ini? Tindakan ini tidak dapat dibatalkan.")) {
                        e.target.value = "";
                        return;
                      }

                      setImporting(true);
                      try {
                        const text = await file.text();
                        const parsed = JSON.parse(text);

                        const res = await fetch("/api/db/import", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
                          },
                          body: JSON.stringify(parsed)
                        });

                        if (res.ok) {
                          onShowNotification("Database berhasil dipulihkan secara instan!", "success");
                          setTimeout(() => {
                            window.location.reload();
                          }, 1200);
                        } else {
                          const err = await res.json();
                          onShowNotification(err.error || "Gagal mengimpor database.", "error");
                        }
                      } catch (err: any) {
                        onShowNotification("Format file cadangan tidak valid.", "error");
                      } finally {
                        setImporting(false);
                        e.target.value = "";
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById("db-backup-file")?.click()}
                    disabled={importing}
                    className="w-full flex items-center justify-center gap-2 border border-emerald-500/30 hover:border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500 text-white font-mono text-[10px] uppercase font-bold py-3 px-4 transition-all duration-150 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {importing ? "Mengimpor..." : "Pilih & Impor File (.JSON)"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
