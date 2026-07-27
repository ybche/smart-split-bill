import React, { useState, useEffect } from "react";
import { 
  TrendingUp, Users, DollarSign, ListCollapse, Play, CheckCircle, 
  Clock, AlertCircle, Plus, Receipt, Landmark, RefreshCw, ChevronRight, 
  Activity as ActivityIcon, Award, PieChart, Info, CheckCircle2, LogOut, 
  Settings, Key, Sparkles, User, HelpCircle, FileText, AlertTriangle, Menu, X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "./lib/supabase";

// Component imports
import Dashboard from "./components/Dashboard";
import Categories from "./components/Categories";
import Transactions from "./components/Transactions";
import Participants from "./components/Participants";
import Payments from "./components/Payments";
import PaymentMethods from "./components/PaymentMethods";
import Reports from "./components/Reports";
import PayPortal from "./components/PayPortal";
import SettingsComponent from "./components/Settings";

interface ToastNotification {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<any | null>(null);
  const [isSetupRequired, setIsSetupRequired] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Sign In / Setup form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submittingAuth, setSubmittingAuth] = useState(false);

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"admin" | "participant">("admin");

  const navItems = [
    { path: "/app", label: "Dashboard", icon: TrendingUp },
    { path: "/app/categories", label: "Categories", icon: ListCollapse },
    { path: "/app/transactions", label: "Transactions", icon: Receipt },
    { path: "/app/participants", label: "Participants", icon: Users },
    { path: "/app/payments", label: "Payments", icon: DollarSign },
    { path: "/app/payment-methods", label: "Payment Methods", icon: Landmark },
    { path: "/app/reports", label: "Reports & Logs", icon: FileText },
    { path: "/app/settings", label: "Settings", icon: Settings },
  ];
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingPortal, setSearchingPortal] = useState(false);
  const [foundPortals, setFoundPortals] = useState<any[] | null>(null);

  const handleSearchPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      showNotification("Silakan masukkan nama, nomor HP, atau token Anda.", "error");
      return;
    }
    setSearchingPortal(true);
    setFoundPortals(null);
    try {
      const res = await fetch("/api/public/find-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.token) {
          navigate(`/pay/${data.token}`);
        } else if (data.results && data.results.length > 0) {
          setFoundPortals(data.results);
          if (data.results.length === 1) {
            navigate(`/pay/${data.results[0].token}`);
          }
        }
      } else {
        showNotification(data.error || "Peserta tidak ditemukan.", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Terjadi kesalahan saat mencari portal.", "error");
    } finally {
      setSearchingPortal(false);
    }
  };

  // Notification Toast state
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  // Show a gorgeous notification toast
  const showNotification = (message: string, type: "success" | "error" | "info" = "success") => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Monitor browser history navigations
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  // Set up custom programmatic navigation function
  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  // Check setup status
  const checkSetupStatus = async () => {
    try {
      const res = await fetch("/api/auth/status");
      if (res.ok) {
        const data = await res.json();
        setIsSetupRequired(data.setupRequired);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingSetup(false);
    }
  };

  // Check token authenticity and retrieve administrator user profile details
  const loadProfile = async (tok: string) => {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { "Authorization": `Bearer ${tok}` }
      });
      if (res.ok) {
        const profile = await res.json();
        setAdminUser(profile);
      } else {
        await supabase.auth.signOut();
        showNotification("Session expired. Please log in again.", "info");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Admin auth is handled by Supabase Auth directly on the client. Keep
  // adminToken in sync with the current Supabase session (including
  // automatic token refresh) via onAuthStateChange.
  useEffect(() => {
    checkSetupStatus();

    supabase.auth.getSession().then(({ data }) => {
      setAdminToken(data.session?.access_token ?? null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAdminToken(session?.access_token ?? null);
      if (!session) setAdminUser(null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (adminToken) {
      loadProfile(adminToken);
    }
  }, [adminToken]);

  const handleAdminSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !displayName) {
      showNotification("Please fill in all details.", "error");
      return;
    }

    setSubmittingAuth(true);
    try {
      const res = await fetch("/api/auth/bootstrap-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password, displayName })
      });

      if (res.ok) {
        showNotification("Administrator account created! Proceeding to sign in...", "success");
        setIsSetupRequired(false);
        await handleAdminSignIn(e);
      } else {
        const err = await res.json();
        showNotification(err.error || "Setup failed.", "error");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      showNotification("Username and password are required.", "error");
      return;
    }

    setSubmittingAuth(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: username, password });

      if (!error && data.session) {
        setAdminToken(data.session.access_token);
        showNotification("Welcome back!", "success");
        navigate("/app");
      } else {
        showNotification(error?.message || "Username atau kata sandi salah.", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Terjadi kesalahan saat autentikasi.", "error");
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAdminToken(null);
    setAdminUser(null);
    showNotification("Sign out completed successfully.", "info");
    navigate("/login");
  };

  // Determine current routing structure
  const payMatch = currentPath.match(/\/pay\/([a-zA-Z0-9-]+)/);

  // 1. PUBLIC PAYMENT PORTAL ROUTE
  if (payMatch) {
    const token = payMatch[1];
    return (
      <div className="App selection:bg-indigo-500 selection:text-white">
        <PayPortal token={token} onShowNotification={showNotification} />
        {/* Render Floating Toasts */}
        <div className="fixed bottom-5 right-5 z-50 space-y-2">
          {toasts.map(t => (
            <div 
              key={t.id}
              className={`p-4 rounded-xl shadow-lg border flex items-center gap-2.5 text-xs font-semibold max-w-sm bg-white text-slate-800 ${
                t.type === "success" ? "border-emerald-500 ring-2 ring-emerald-50" :
                t.type === "error" ? "border-rose-500 ring-2 ring-rose-50" : "border-blue-500 ring-2 ring-blue-50"
              }`}
            >
              {t.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
              {t.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-500" />}
              {t.type === "info" && <Info className="w-5 h-5 text-blue-500" />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Loading setup check
  if (checkingSetup) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D0D0F] text-[#F9F9F7]/70 dot-pattern">
        <RefreshCw className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <span className="font-mono text-xs uppercase tracking-[0.2em]">Authenticating system handshake...</span>
      </div>
    );
  }

  // 2. SETUP MODE (CAT-001 / Setup wizard if database empty)
  if (isSetupRequired) {
    return (
      <div className="min-h-screen bg-[#0D0D0F] flex flex-col items-center justify-center p-4 relative overflow-hidden dot-pattern">
        {/* Glow */}
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 blur-[150px] rounded-full"></div>
        
        <div className="bg-white/[0.02] backdrop-blur-md rounded-lg border border-white/10 w-full max-w-md overflow-hidden text-left relative z-10 shadow-2xl">
          <div className="p-8 border-b border-white/5 text-center">
            <Sparkles className="w-8 h-8 text-blue-400 mx-auto animate-pulse mb-3" />
            <h1 className="editorial-title text-3xl font-black italic text-[#F9F9F7]">Setup System_</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[#F9F9F7]/40 mt-1.5">Configure your root profile details below.</p>
          </div>

          <form onSubmit={handleAdminSignup} className="p-8 space-y-5">
            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Your Full Name *</label>
              <input 
                type="text"
                required
                placeholder="e.g. Yeb"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors placeholder:opacity-30"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Sign In Username *</label>
              <input 
                type="text"
                required
                placeholder="e.g. admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors placeholder:opacity-30"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Root Secret Password *</label>
              <input 
                type="password"
                required
                placeholder="Min 6 characters recommended"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors placeholder:opacity-30"
              />
            </div>

            <button 
              type="submit"
              disabled={submittingAuth}
              className="w-full bg-white text-black font-mono uppercase tracking-[0.2em] text-[11px] font-bold py-3 hover:bg-neutral-200 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2"
            >
              {submittingAuth ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Confirm Setup"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. UNAUTHENTICATED LOGIN ROUTE
  if (!adminToken) {
    return (
      <div className="min-h-screen bg-[#0D0D0F] flex flex-col items-center justify-center p-4 relative overflow-hidden dot-pattern">
        {/* Glow */}
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 blur-[150px] rounded-full"></div>

        <div className="bg-white/[0.02] backdrop-blur-md rounded-lg border border-white/10 w-full max-w-md overflow-hidden text-left relative z-10 shadow-2xl">
          <div className="p-6 border-b border-white/5 text-center">
            <h1 className="editorial-title text-4xl font-black italic text-[#F9F9F7] tracking-tight">Smart Split Bill</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[#F9F9F7]/40 mt-1.5">Sistem Manajemen Tagihan & Split Bill</p>
            
            {/* Mode Tabs */}
            <div className="flex bg-white/[0.04] p-1 rounded-md border border-white/10 mt-5">
              <button
                type="button"
                onClick={() => setAuthTab("admin")}
                className={`flex-1 py-2 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-all cursor-pointer ${
                  authTab === "admin" 
                    ? "bg-white text-black shadow-sm font-bold" 
                    : "text-white/60 hover:text-white"
                }`}
              >
                Admin Login
              </button>
              <button
                type="button"
                onClick={() => setAuthTab("participant")}
                className={`flex-1 py-2 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-all cursor-pointer ${
                  authTab === "participant" 
                    ? "bg-blue-600 text-white shadow-sm font-bold" 
                    : "text-white/60 hover:text-white"
                }`}
              >
                Portal Peserta
              </button>
            </div>
          </div>

          {authTab === "admin" ? (
            <form onSubmit={handleAdminSignIn} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-1.5">Username / Email Admin</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors placeholder:opacity-30"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-1.5">Kata Sandi</label>
                <input 
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors"
                />
              </div>

              <button 
                type="submit"
                disabled={submittingAuth}
                className="w-full bg-white text-black font-mono uppercase tracking-[0.2em] text-[11px] font-bold py-3 hover:bg-neutral-200 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2 rounded-md shadow-lg"
              >
                {submittingAuth ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Masuk Sebagai Admin"}
              </button>
            </form>
          ) : (
            <div className="p-6 space-y-4">
              <div className="p-3 bg-white/[0.03] border border-white/10 rounded-md text-xs text-white/70">
                <p className="font-sans text-xs">Akses portal pembayaran pribadi Anda dengan memasukkan Nomor HP atau Token Personal Anda.</p>
              </div>

              <form onSubmit={handleSearchPortal} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-1.5">Nomor HP / Personal Token</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: 08123456789"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.06] text-[#F9F9F7] font-sans transition-colors placeholder:opacity-30"
                  />
                </div>

                <button 
                  type="submit"
                  disabled={searchingPortal}
                  className="w-full bg-blue-600 text-white font-mono uppercase tracking-[0.15em] text-[11px] font-bold py-3 hover:bg-blue-500 transition-colors cursor-pointer flex items-center justify-center gap-2 rounded-md shadow-lg"
                >
                  {searchingPortal ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Cari & Buka Portal Pembayaran"}
                </button>
              </form>

              {foundPortals && foundPortals.length > 0 && (
                <div className="space-y-2 mt-4 pt-4 border-t border-white/10">
                  <p className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Hasil Pencarian Peserta ({foundPortals.length}):</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {foundPortals.map((item, idx) => (
                      <div 
                        key={idx}
                        onClick={() => navigate(`/pay/${item.token}`)}
                        className="p-3 bg-white/[0.04] hover:bg-blue-600/20 border border-white/10 rounded-md cursor-pointer transition-all flex items-center justify-between group"
                      >
                        <div>
                          <p className="text-sm font-bold text-white group-hover:text-blue-300">{item.participantName}</p>
                          <p className="text-xs text-white/50">{item.categoryName}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-blue-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Floating Toasts on Login screen */}
        <div className="fixed bottom-5 right-5 z-50 space-y-2">
          {toasts.map(t => (
            <div 
              key={t.id}
              className={`p-4 rounded-xl shadow-lg border flex items-center gap-2.5 text-xs font-semibold max-w-sm bg-white text-slate-800 ${
                t.type === "success" ? "border-emerald-500 ring-2 ring-emerald-50" :
                t.type === "error" ? "border-rose-500 ring-2 ring-rose-50" : "border-blue-500 ring-2 ring-blue-50"
              }`}
            >
              {t.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
              {t.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-500" />}
              {t.type === "info" && <Info className="w-5 h-5 text-blue-500" />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Determine current active component view (Admin Routing client-side)
  let activeComponent = <Dashboard token={adminToken} admin={adminUser} onNavigate={navigate} onShowNotification={showNotification} />;
  
  if (currentPath === "/app/categories") {
    activeComponent = <Categories token={adminToken} admin={adminUser} onNavigate={navigate} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/transactions") {
    activeComponent = <Transactions token={adminToken} onNavigate={navigate} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/participants") {
    activeComponent = <Participants token={adminToken} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/payments") {
    activeComponent = <Payments token={adminToken} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/payment-methods") {
    activeComponent = <PaymentMethods token={adminToken} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/reports") {
    activeComponent = <Reports token={adminToken} onShowNotification={showNotification} />;
  } else if (currentPath === "/app/settings") {
    activeComponent = <SettingsComponent token={adminToken} admin={adminUser} onShowNotification={showNotification} />;
  }

  return (
    <div className="App min-h-screen bg-[#0D0D0F] text-[#F9F9F7] selection:bg-blue-600 selection:text-white relative overflow-x-hidden dot-pattern pb-16">
      
      {/* Decorative gradient glow (Section 4) */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/5 blur-[130px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[20%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/5 blur-[130px] rounded-full pointer-events-none"></div>

      {/* Persistent Administrator Navigation Rail */}
      <nav className="sticky top-0 z-40 w-full bg-[#0D0D0F]/90 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6 lg:gap-10">
          {/* Logo Brand */}
          <div 
            onClick={() => {
              navigate("/app");
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-white text-black rounded-none flex items-center justify-center font-display font-black text-sm sm:text-base uppercase italic group-hover:scale-105 transition-transform">
              F.
            </div>
            <div>
              <span className="font-display font-black tracking-tighter text-sm sm:text-base uppercase italic leading-none block">Fragment.</span>
              <span className="text-[8px] font-mono text-blue-400 block uppercase tracking-[0.3em] font-bold mt-0.5">Console</span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-semibold transition-all duration-200 cursor-pointer ${
                  currentPath === item.path ? "text-blue-400 border-b-2 border-blue-400 font-bold" : "text-[#F9F9F7]/50 hover:text-[#F9F9F7]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Administrator Dropdown / Identity profile & Mobile Toggle */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden md:flex flex-col text-right">
            <span className="text-xs font-semibold text-[#F9F9F7]">{adminUser?.displayName || "Administrator"}</span>
            <span className="text-[9px] text-[#F9F9F7]/40 uppercase tracking-widest font-mono mt-0.5">System Owner</span>
          </div>

          <button 
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-white/10 hover:border-red-500/40 hover:bg-red-500/5 text-[#F9F9F7]/60 hover:text-red-400 text-[10px] font-mono uppercase tracking-widest cursor-pointer transition-colors rounded"
            title="Sign out of Admin Console"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Exit</span>
          </button>

          {/* Mobile Menu Hamburger Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded bg-white/[0.06] border border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-mono"
            aria-label="Toggle Mobile Menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4 text-rose-400" /> : <Menu className="w-4 h-4 text-blue-400" />}
            <span className="text-[10px] uppercase tracking-wider font-bold">Nav</span>
          </button>
        </div>
      </nav>

      {/* Mobile Horizontal Scrollable Tab Bar (Always accessible on Mobile) */}
      <div className="lg:hidden sticky top-[57px] z-30 w-full bg-[#0D0D0F]/95 backdrop-blur-md border-b border-white/10 px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar shadow-lg">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.path;
          return (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path);
                setMobileMenuOpen(false);
              }}
              className={`px-3 py-1.5 rounded text-[11px] font-mono font-medium whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? "bg-blue-600 text-white font-bold shadow-md ring-1 ring-blue-400/50"
                  : "bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white border border-white/5"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Expandable Mobile Drawer Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden sticky top-[100px] z-30 w-full bg-[#121216] border-b border-white/10 p-4 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
              <span className="text-[10px] font-mono uppercase tracking-widest text-blue-400 font-bold">Pilih Menu Administrasi</span>
              <span className="text-[10px] font-mono text-white/40">{adminUser?.displayName || "Admin"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setMobileMenuOpen(false);
                    }}
                    className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all cursor-pointer ${
                      isActive
                        ? "bg-blue-600/20 border-blue-500 text-white font-bold"
                        : "bg-white/[0.03] border-white/10 text-white/80 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <div className={`p-2 rounded ${isActive ? "bg-blue-600 text-white" : "bg-white/5 text-white/60"}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-medium font-sans truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container Stage wrapper */}
      <main className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPath}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
          >
            {activeComponent}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Global Toasts notifications */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map(t => (
          <div 
            key={t.id}
            className={`p-4 rounded-none shadow-2xl border flex items-center gap-3 text-xs font-semibold max-w-sm bg-[#121214] text-[#F9F9F7] ${
              t.type === "success" ? "border-blue-500" :
              t.type === "error" ? "border-rose-500" : "border-yellow-500"
            }`}
          >
            {t.type === "success" && <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />}
            {t.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
            {t.type === "info" && <Info className="w-5 h-5 text-yellow-400 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
