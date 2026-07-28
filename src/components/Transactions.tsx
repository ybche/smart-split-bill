import React, { useState, useEffect } from "react";
import {
  Plus, Search, Edit3, Trash2, Receipt, Calendar, Info, AlertTriangle,
  CheckCircle, PlusCircle, MinusCircle, FileUp, RefreshCw, X, Eye, Sparkles,
  ArrowUp, ArrowDown, ArrowUpDown
} from "lucide-react";
import { Transaction, Category, Participant } from "../types";

interface TransactionsProps {
  token: string;
  onNavigate: (path: string) => void;
  onShowNotification: (msg: string, type: "success" | "error" | "info") => void;
}

interface FormItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  splitMethod: "Equal" | "Ratio" | "Percentage" | "Custom" | "Quantity" | "FreeInput";
  itemAllocations: Array<{ participantId: string; weight: number }>; // weight maps to weight, custom amount, percentage, or quantity — for FreeInput items, weight is just an inclusion flag (0 or 1), not a price weight
  // Existing free-input declarations for this item, keyed by participantId
  // (only populated when editing an existing transaction).
  freeInputDeclarations?: Record<string, { allocationId: string; status: string; amount: number; rejectionReason?: string }>;
}

// The participant's declared amount counts immediately once submitted — no
// admin approval gates it. Admin only has an optional override: reject,
// which reopens the item for the participant to redeclare.
function FreeInputDeclarationBadge({ declaration, formatIDR, onReject }: {
  declaration: { status: string; amount: number; rejectionReason?: string };
  formatIDR: (val: number) => string;
  onReject: () => void;
}) {
  if (declaration.status === "AwaitingInput") {
    return <span className="text-[10px] text-[#F9F9F7]/30 italic">Belum diisi peserta</span>;
  }
  if (declaration.status === "Rejected") {
    return (
      <span className="text-[10px] text-rose-400" title={declaration.rejectionReason}>
        Ditolak: {formatIDR(declaration.amount)}
      </span>
    );
  }
  // Approved (the only other reachable state) — active immediately, admin
  // can still reopen it if something looks wrong.
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-emerald-400 font-bold">{formatIDR(declaration.amount)}</span>
      <button
        type="button"
        onClick={onReject}
        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 p-1 transition-all cursor-pointer"
        title="Buka kembali (peserta perlu isi ulang)"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function Transactions({ token, onNavigate, onShowNotification }: TransactionsProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  // Form / Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Core Form Fields
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [payerId, setPayerId] = useState("admin"); // 'admin' or participantId
  const [expenseClassification, setExpenseClassification] = useState<"Food" | "Transportation" | "Accommodation" | "Entertainment" | "Shopping" | "Other">("Other");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  // Subtotals and charges fields
  const [subtotal, setSubtotal] = useState(0);
  const [tax, setTax] = useState(0);
  const [serviceCharge, setServiceCharge] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [otherFees, setOtherFees] = useState(0);
  const [total, setTotal] = useState(0);

  // Items Allocations Form list
  const [formItems, setFormItems] = useState<FormItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Category specific participants mapping (used for splitting checkboxes)
  const [categoryParticipants, setCategoryParticipants] = useState<Participant[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);

  // Quick-Add Participant States
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddPhone, setQuickAddPhone] = useState("");
  const [quickAddSelectedId, setQuickAddSelectedId] = useState("");

  // Receipt OCR states
  const [scanning, setScanning] = useState(false);
  const [ocrReviewData, setOcrReviewData] = useState<any | null>(null);

  // Search filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("all");
  const [sortBy, setSortBy] = useState<"title" | "category" | "payer" | "classification" | "date" | "total">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchTransactionsData = async () => {
    setLoading(true);
    try {
      const headers = { "Authorization": `Bearer ${token}` };
      const [resTx, resCat, resPart] = await Promise.all([
        fetch("/api/transactions", { headers }),
        fetch("/api/categories", { headers }),
        fetch("/api/participants", { headers })
      ]);

      if (resTx.ok && resCat.ok && resPart.ok) {
        setTransactions(await resTx.json());
        setCategories(await resCat.json());
        setParticipants(await resPart.json());
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Gagal memuat data.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactionsData();
  }, []);

  // Fetch participants linked specifically to selected category for item mappings
  useEffect(() => {
    if (!selectedCategoryId) {
      setCategoryParticipants([]);
      setSelectedParticipantIds([]);
      return;
    }
    const loadCategoryParticipants = async () => {
      try {
        const res = await fetch(`/api/categories/${selectedCategoryId}/details`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const detail = await res.json();
          setCategoryParticipants(detail.participants);
          if (!editingId) {
            setSelectedParticipantIds(detail.participants.map((p: any) => p.id));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadCategoryParticipants();
  }, [selectedCategoryId]);

  // Sync total arithmetic dynamically (TRX-001 / 8.2)
  useEffect(() => {
    const calcSub = formItems.reduce((sum, item) => sum + item.lineTotal, 0);
    setSubtotal(calcSub);
  }, [formItems]);

  useEffect(() => {
    const calcTotal = Number(subtotal) + Number(tax) + Number(serviceCharge) + Number(otherFees) - Number(discount);
    setTotal(Math.max(0, calcTotal));
  }, [subtotal, tax, serviceCharge, discount, otherFees]);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setSelectedCategoryId("");
    setSelectedParticipantIds([]);
    setTitle("");
    setMerchant("");
    setDate("");
    setPayerId("admin");
    setExpenseClassification("" as any);
    setDescription("");
    setNotes("");
    setSubtotal(0);
    setTax(0);
    setServiceCharge(0);
    setDiscount(0);
    setOtherFees(0);
    setTotal(0);
    setFormItems([]);
    setOcrReviewData(null);
    setShowModal(true);
  };

  // Loads items + their allocations (including free-input declarations, any
  // status) into the form. Shared by the edit-modal open flow and by the
  // approve/reject handlers, which need to refresh the same view in place.
  const loadFormItemsFromAllocations = async (txId: string) => {
    const res = await fetch(`/api/transactions/${txId}/allocations`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;

    const allocDetail = await res.json();
    const mappedItems: FormItem[] = allocDetail.items.map((it: any) => {
      // An item's allocations are either all split-engine rows or all
      // FreeInput rows — never mixed — since splitMethod is set per item.
      const isFreeInputItem = it.allocations.length > 0 && it.allocations.every((al: any) => al.method === "FreeInput");
      const freeInputDeclarations: Record<string, any> = {};
      if (isFreeInputItem) {
        it.allocations.forEach((al: any) => {
          freeInputDeclarations[al.participantId] = {
            allocationId: al.id,
            status: al.status,
            amount: al.roundedAmount,
            rejectionReason: al.rejectionReason,
          };
        });
      }

      return {
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        splitMethod: isFreeInputItem ? "FreeInput" : "Equal", // Default mapping back as custom ratios are preserved on the server allocations list
        itemAllocations: it.allocations.map((al: any) => ({
          participantId: al.participantId,
          weight: isFreeInputItem ? 1 : (al.roundedAmount > 0 ? 1 : 0)
        })),
        freeInputDeclarations: isFreeInputItem ? freeInputDeclarations : undefined,
      };
    });
    setFormItems(mappedItems);

    // Compute initially active participants from edit allocations
    const activeIds = Array.from(new Set(mappedItems.flatMap(item => item.itemAllocations.filter(a => a.weight > 0).map(a => a.participantId))));
    setSelectedParticipantIds(activeIds);
  };

  const handleOpenEditModal = async (tx: Transaction) => {
    setEditingId(tx.id);
    setSelectedCategoryId(tx.categoryId);
    setTitle(tx.title);
    setMerchant(tx.merchant || "");
    setDate(tx.date);
    setPayerId(tx.payerId);
    setExpenseClassification(tx.expenseClassification);
    setDescription(tx.description || "");
    setNotes(tx.notes || "");
    setSubtotal(tx.subtotal);
    setTax(tx.tax);
    setServiceCharge(tx.serviceCharge);
    setDiscount(tx.discount);
    setOtherFees(tx.otherFees);
    setTotal(tx.total);

    try {
      await loadFormItemsFromAllocations(tx.id);
    } catch (err) {
      console.error(err);
    }

    setShowModal(true);
  };

  // Declared amounts count immediately with no approval step — this is the
  // only admin action on a free-input item: reopen it for the participant
  // to redo, e.g. because the typed amount looks wrong.
  const handleRejectFreeInput = async (allocationId: string) => {
    if (!editingId) return;
    const reason = window.prompt("Alasan membuka kembali deklarasi ini (peserta akan diminta isi ulang):");
    if (!reason) return;

    try {
      const res = await fetch(`/api/transactions/${editingId}/free-input/${allocationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ rejectionReason: reason })
      });
      if (res.ok) {
        onShowNotification("Deklarasi dibuka kembali — peserta akan bisa isi ulang.", "success");
        await loadFormItemsFromAllocations(editingId);
        fetchTransactionsData();
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menolak deklarasi.", "error");
      }
    } catch (err) {
      console.error(err);
      onShowNotification("Terjadi kesalahan jaringan.", "error");
    }
  };

  const handleDeleteTransaction = async (txId: string, force = false) => {
    if (!force && !confirm("Are you sure you want to delete this transaction? All associated obligations will be cleared instantly.")) {
      return;
    }

    try {
      const res = await fetch(`/api/transactions/${txId}${force ? "?force=true" : ""}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (res.ok) {
        onShowNotification("Transaction deleted successfully.", "success");
        fetchTransactionsData();
      } else {
        const err = await res.json();
        if (res.status === 400 && err.canForce) {
          if (confirm(`${err.error}\n\nDo you want to FORCE CASCADE DELETE? This will permanently remove referencing verified payment records as well. WARNING: This action cannot be undone.`)) {
            handleDeleteTransaction(txId, true);
            return;
          }
        }
        onShowNotification(err.error || "Gagal menghapus.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Add line item to form (8.2 Manual input)
  const addFormLineItem = () => {
    const newItem: FormItem = {
      id: crypto.randomUUID(),
      name: "",
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      splitMethod: "Equal",
      itemAllocations: categoryParticipants.map(cp => ({
        participantId: cp.id,
        weight: 0 // Unchecked by default
      }))
    };
    setFormItems([...formItems, newItem]);
  };

  const handleSelectAllItemMembers = (itemId: string) => {
    setFormItems(prevItems => prevItems.map(item => {
      if (item.id === itemId) {
        const itemAllocations = [...item.itemAllocations];
        selectedParticipantIds.forEach(pId => {
          if (!itemAllocations.some(a => a.participantId === pId)) {
            itemAllocations.push({ participantId: pId, weight: 0 });
          }
        });
        const activeCount = selectedParticipantIds.length;
        return {
          ...item,
          itemAllocations: itemAllocations.map(al => {
            if (selectedParticipantIds.includes(al.participantId)) {
              let weight = 1;
              if (item.splitMethod === "Percentage") {
                weight = activeCount > 0 ? Math.round(100 / activeCount) : 100;
              } else if (item.splitMethod === "Custom") {
                weight = activeCount > 0 ? Math.round(item.lineTotal / activeCount) : item.lineTotal;
              }
              return { ...al, weight };
            }
            return { ...al, weight: 0 };
          })
        };
      }
      return item;
    }));
  };

  const handleClearAllItemMembers = (itemId: string) => {
    setFormItems(prevItems => prevItems.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          itemAllocations: item.itemAllocations.map(al => ({ ...al, weight: 0 }))
        };
      }
      return item;
    }));
  };

  const removeFormLineItem = (itemId: string) => {
    setFormItems(formItems.filter(item => item.id !== itemId));
  };

  const updateFormItemField = (itemId: string, field: keyof FormItem, val: any) => {
    const updated = formItems.map(item => {
      if (item.id === itemId) {
        const copy = { ...item, [field]: val };
        if (field === "quantity" || field === "unitPrice") {
          copy.lineTotal = Math.round(Number(copy.quantity || 0) * Number(copy.unitPrice || 0));
        }
        return copy;
      }
      return item;
    });
    setFormItems(updated);
  };

  const updateItemParticipantWeight = (itemId: string, pId: string, weight: number) => {
    const updated = formItems.map(item => {
      if (item.id === itemId) {
        const itemAllocations = item.itemAllocations.map(al => {
          if (al.participantId === pId) {
            return { ...al, weight: Number(weight) };
          }
          return al;
        });

        // Ensure current participant is registered in allocation mapping
        const hasP = itemAllocations.some(al => al.participantId === pId);
        if (!hasP) {
          itemAllocations.push({ participantId: pId, weight: Number(weight) });
        }

        return { ...item, itemAllocations };
      }
      return item;
    });
    setFormItems(updated);
  };

  const handleToggleGlobalParticipant = async (pId: string) => {
    let nextIds = [...selectedParticipantIds];
    const isAdding = !nextIds.includes(pId);
    if (isAdding) {
      nextIds.push(pId);
    } else {
      nextIds = nextIds.filter(id => id !== pId);
    }
    setSelectedParticipantIds(nextIds);

    // Auto-map if adding a participant not yet linked to the category
    const isMapped = categoryParticipants.some(cp => cp.id === pId);
    if (isAdding && !isMapped && selectedCategoryId) {
      try {
        const res = await fetch(`/api/categories/${selectedCategoryId}/participants`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ participantIds: [pId] })
        });
        if (res.ok) {
          const resDetails = await fetch(`/api/categories/${selectedCategoryId}/details`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (resDetails.ok) {
            const detail = await resDetails.json();
            setCategoryParticipants(detail.participants);
          }
        }
      } catch (err) {
        console.error("Auto-mapping participant failed:", err);
      }
    }

    setFormItems(prevItems => prevItems.map(item => {
      let itemAllocations = [...item.itemAllocations];
      const hasA = itemAllocations.some(a => a.participantId === pId);
      if (!hasA) {
        itemAllocations.push({ participantId: pId, weight: isAdding ? 1 : 0 });
      }

      return {
        ...item,
        itemAllocations: itemAllocations.map(al => {
          if (al.participantId === pId) {
            return { ...al, weight: isAdding ? 1 : 0 };
          }
          return al;
        })
      };
    }));
  };

  const handleSelectAllGlobalParticipants = async () => {
    const activeCandidates = [
      ...categoryParticipants,
      ...participants.filter(p => p.active && !categoryParticipants.some(cp => cp.id === p.id))
    ];
    const allIds = activeCandidates.map(cp => cp.id);
    setSelectedParticipantIds(allIds);

    const unmappedIds = allIds.filter(id => !categoryParticipants.some(cp => cp.id === id));
    if (unmappedIds.length > 0 && selectedCategoryId) {
      try {
        const res = await fetch(`/api/categories/${selectedCategoryId}/participants`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ participantIds: unmappedIds })
        });
        if (res.ok) {
          const resDetails = await fetch(`/api/categories/${selectedCategoryId}/details`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (resDetails.ok) {
            const detail = await resDetails.json();
            setCategoryParticipants(detail.participants);
          }
        }
      } catch (err) {
        console.error("Bulk auto-mapping failed:", err);
      }
    }

    setFormItems(prevItems => prevItems.map(item => {
      let itemAllocations = [...item.itemAllocations];
      allIds.forEach(id => {
        if (!itemAllocations.some(a => a.participantId === id)) {
          itemAllocations.push({ participantId: id, weight: 1 });
        }
      });

      return {
        ...item,
        itemAllocations: itemAllocations.map(al => ({
          ...al,
          weight: 1 // Auto-check for all selected members
        }))
      };
    }));
  };

  const handleClearAllGlobalParticipants = () => {
    setSelectedParticipantIds([]);
    setFormItems(prevItems => prevItems.map(item => {
      return {
        ...item,
        itemAllocations: item.itemAllocations.map(al => ({
          ...al,
          weight: 0
        }))
      };
    }));
  };

  const handleQuickLinkParticipant = async () => {
    if (!selectedCategoryId || !quickAddSelectedId) return;
    try {
      const res = await fetch(`/api/categories/${selectedCategoryId}/participants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ participantIds: [quickAddSelectedId] })
      });
      if (res.ok) {
        onShowNotification("Member linked to category successfully!", "success");
        // Reload category details & master list
        const resDetails = await fetch(`/api/categories/${selectedCategoryId}/details`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (resDetails.ok) {
          const detail = await resDetails.json();
          setCategoryParticipants(detail.participants);
          
          // Add to selectedParticipantIds
          setSelectedParticipantIds(prev => Array.from(new Set([...prev, quickAddSelectedId])));
          
          // Also update formItems to include this new participant with weight 1 (for current items)
          setFormItems(prevItems => prevItems.map(item => {
            const hasP = item.itemAllocations.some(a => a.participantId === quickAddSelectedId);
            if (!hasP) {
              return {
                ...item,
                itemAllocations: [...item.itemAllocations, { participantId: quickAddSelectedId, weight: 1 }]
              };
            }
            return item;
          }));
        }
        setQuickAddSelectedId("");
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal menambahkan anggota.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickCreateParticipant = async () => {
    if (!selectedCategoryId || !quickAddName || !quickAddPhone) return;
    try {
      const res = await fetch(`/api/categories/${selectedCategoryId}/participants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          participantIds: [],
          newParticipants: [{ fullName: quickAddName, phone: quickAddPhone }]
        })
      });
      if (res.ok) {
        onShowNotification("New member created and linked successfully!", "success");
        // Reload category details, master list
        const [resDetails, resPart] = await Promise.all([
          fetch(`/api/categories/${selectedCategoryId}/details`, {
            headers: { "Authorization": `Bearer ${token}` }
          }),
          fetch("/api/participants", {
            headers: { "Authorization": `Bearer ${token}` }
          })
        ]);
        
        if (resDetails.ok && resPart.ok) {
          const detail = await resDetails.json();
          const masterParts = await resPart.json();
          setCategoryParticipants(detail.participants);
          setParticipants(masterParts);
          
          // Find the newly created participant's ID
          const normalized = quickAddPhone.replace(/\D/g, "");
          const newCp = detail.participants.find((p: any) => p.normalizedPhone === normalized || p.phone === quickAddPhone);
          const newId = newCp ? newCp.id : null;
          
          if (newId) {
            // Add to selectedParticipantIds
            setSelectedParticipantIds(prev => Array.from(new Set([...prev, newId])));

            setFormItems(prevItems => prevItems.map(item => {
              const hasP = item.itemAllocations.some(a => a.participantId === newId);
              if (!hasP) {
                return {
                  ...item,
                  itemAllocations: [...item.itemAllocations, { participantId: newId, weight: 1 }]
                };
              }
              return item;
            }));
          }
        }
        setQuickAddName("");
        setQuickAddPhone("");
        setShowQuickAdd(false);
      } else {
        const err = await res.json();
        onShowNotification(err.error || "Gagal membuat anggota.", "error");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Drag-and-drop base64 receipt scanning (8.1)
  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Str = (reader.result as string).split(",")[1];
      
      try {
        const res = await fetch("/api/scan-receipt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            base64Image: base64Str,
            mimeType: file.type
          })
        });

        if (res.ok) {
          const resJson = await res.json();
          const scan = resJson.data;

          onShowNotification("Receipt OCR scanned successfully!", "success");
          
          // Pre-fill fields from scanned result
          setTitle(scan.merchant || "Scanned Receipt");
          setMerchant(scan.merchant || "");
          if (scan.date) setDate(scan.date);
          
          setTax(scan.tax || 0);
          setServiceCharge(scan.serviceCharge || 0);
          setDiscount(scan.discount || 0);
          setOtherFees(scan.otherFees || 0);

          // Populate line items
          let targetParticipantIds = selectedParticipantIds;
          if (targetParticipantIds.length === 0 && categoryParticipants.length > 0) {
            targetParticipantIds = categoryParticipants.map(cp => cp.id);
            setSelectedParticipantIds(targetParticipantIds);
          } else if (targetParticipantIds.length === 0 && participants.length > 0) {
            targetParticipantIds = participants.filter(p => p.active).map(p => p.id);
            setSelectedParticipantIds(targetParticipantIds);
          }

          if (Array.isArray(scan.items)) {
            const availableMembers = categoryParticipants.length > 0 ? categoryParticipants : participants.filter(p => p.active);
            const mapped: FormItem[] = scan.items.map((it: any) => ({
              id: crypto.randomUUID(),
              name: it.name,
              quantity: it.quantity || 1,
              unitPrice: it.unitPrice || it.lineTotal || 0,
              lineTotal: it.lineTotal || (it.quantity * it.unitPrice) || 0,
              splitMethod: "Equal",
              itemAllocations: availableMembers.map(cp => ({
                participantId: cp.id,
                weight: targetParticipantIds.includes(cp.id) ? 1 : (targetParticipantIds.length === 0 ? 1 : 0)
              }))
            }));
            setFormItems(mapped);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          onShowNotification(errData.error || "Receipt OCR failed to parse structured items.", "error");
        }
      } catch (err) {
        console.error(err);
        onShowNotification("Error during scan upload.", "error");
      } finally {
        setScanning(false);
      }
    };
  };

  // Helper to batch assign selected members across ALL form items
  const handleAssignMembersToAllItems = () => {
    let targetIds = selectedParticipantIds;
    if (targetIds.length === 0) {
      if (categoryParticipants.length > 0) {
        targetIds = categoryParticipants.map(cp => cp.id);
        setSelectedParticipantIds(targetIds);
      } else {
        targetIds = participants.filter(p => p.active).map(p => p.id);
        setSelectedParticipantIds(targetIds);
      }
    }

    if (targetIds.length === 0) {
      onShowNotification("Please select or add category participants first.", "error");
      return;
    }

    setFormItems(prevItems => prevItems.map(item => {
      let itemAllocations = [...item.itemAllocations];
      targetIds.forEach(pId => {
        if (!itemAllocations.some(a => a.participantId === pId)) {
          itemAllocations.push({ participantId: pId, weight: 0 });
        }
      });
      const activeCount = targetIds.length;
      return {
        ...item,
        itemAllocations: itemAllocations.map(al => {
          if (targetIds.includes(al.participantId)) {
            let weight = 1;
            if (item.splitMethod === "Percentage") {
              weight = activeCount > 0 ? Math.round(100 / activeCount) : 100;
            } else if (item.splitMethod === "Custom") {
              weight = activeCount > 0 ? Math.round(item.lineTotal / activeCount) : item.lineTotal;
            }
            return { ...al, weight };
          }
          return { ...al, weight: 0 };
        })
      };
    }));
    onShowNotification(`Assigned ${targetIds.length} members across all ${formItems.length} line items!`, "success");
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!selectedCategoryId) {
      onShowNotification("Category / Project Container selection is required (*).", "error");
      return;
    }
    if (!date) {
      onShowNotification("Transaction date is required (*). Please select a date.", "error");
      return;
    }
    if (!expenseClassification) {
      onShowNotification("Expense classification selection is required (*).", "error");
      return;
    }
    if (formItems.length === 0) {
      onShowNotification("Please add at least one line item.", "error");
      return;
    }

    // Pre-Save Validation (9.5)
    // 1. Every item has at least one participant checked
    const unallocatedIndices = formItems
      .map((item, idx) => ({ item, num: idx + 1 }))
      .filter(({ item }) => item.itemAllocations.filter(a => a.weight > 0).length === 0)
      .map(({ num }) => `#${num}`);

    if (unallocatedIndices.length > 0) {
      onShowNotification(`Item(s) ${unallocatedIndices.join(", ")} have no members assigned. Use '[Assign Members to All Items]' or assign members to each item.`, "error");
      return;
    }

    // 2. Validate Custom Amount sums if split is 'Custom'
    const invalidCustomIndices = formItems
      .map((item, idx) => ({ item, num: idx + 1 }))
      .filter(({ item }) => {
        if (item.splitMethod === "Custom") {
          const sum = item.itemAllocations.reduce((s, a) => s + (a.weight || 0), 0);
          return Math.abs(sum - item.lineTotal) > 1;
        }
        return false;
      })
      .map(({ num }) => `#${num}`);

    if (invalidCustomIndices.length > 0) {
      onShowNotification(`Item(s) ${invalidCustomIndices.join(", ")} custom split amounts do not sum up to item totals.`, "error");
      return;
    }

    setSubmitting(true);

    const payload = {
      categoryId: selectedCategoryId,
      title,
      merchant: merchant || title,
      date,
      payerId,
      subtotal,
      tax,
      serviceCharge,
      discount,
      otherFees,
      total,
      expenseClassification,
      items: formItems,
      description,
      notes
    };

    try {
      const url = editingId ? `/api/transactions/${editingId}` : "/api/transactions";
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
        onShowNotification(editingId ? "Transaction updated successfully!" : "Transaction split recorded and confirmed!", "success");
        setShowModal(false);
        try {
          await fetchTransactionsData();
        } catch (refreshErr) {
          console.error("Data refresh after save error:", refreshErr);
        }
      } else {
        let errorMsg = "Gagal menyimpan transaksi.";
        try {
          const err = await res.json();
          if (err && err.error) errorMsg = err.error;
        } catch (jsonErr) {
          console.error("Error parsing API error response:", jsonErr);
        }
        onShowNotification(errorMsg, "error");
      }
    } catch (err: any) {
      console.error("Save transaction error:", err);
      onShowNotification(err?.message || "Terjadi kesalahan saat menyimpan transaksi.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (t.merchant && t.merchant.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat = filterCategoryId === "all" || t.categoryId === filterCategoryId;
    return matchesSearch && matchesCat;
  });

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder(field === "date" || field === "total" ? "desc" : "asc");
    }
  };

  const payerNameOf = (tx: Transaction) => tx.payerId === "admin" ? "Administrator" : (participants.find(p => p.id === tx.payerId)?.fullName || "");
  const categoryNameOf = (tx: Transaction) => categories.find(c => c.id === tx.categoryId)?.name || "";

  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    let compareVal = 0;
    switch (sortBy) {
      case "title":
        compareVal = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        break;
      case "category":
        compareVal = categoryNameOf(a).localeCompare(categoryNameOf(b), undefined, { sensitivity: "base" });
        break;
      case "payer":
        compareVal = payerNameOf(a).localeCompare(payerNameOf(b), undefined, { sensitivity: "base" });
        break;
      case "classification":
        compareVal = (a.expenseClassification || "Other").localeCompare(b.expenseClassification || "Other", undefined, { sensitivity: "base" });
        break;
      case "date":
        compareVal = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
      case "total":
        compareVal = a.total - b.total;
        break;
    }
    return sortOrder === "asc" ? compareVal : -compareVal;
  });

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const allCandidates = [
    ...categoryParticipants,
    ...participants.filter(p => p.active && !categoryParticipants.some(cp => cp.id === p.id))
  ].sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }));

  return (
    <div className="space-y-8">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <span className="text-blue-500 font-mono text-[10px] tracking-widest uppercase mb-2 block">Ledger & Invoice splitting</span>
          <h1 className="editorial-title text-5xl font-black italic text-[#F9F9F7] tracking-tight">
            Transactions_
          </h1>
          <p className="text-[#F9F9F7]/50 text-xs mt-2 max-w-xl leading-relaxed">
            Add manual transaction receipts, upload images for Gemini multimodal OCR parsing, and configure item-level allocations.
          </p>
        </div>
        <button 
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-mono font-bold uppercase tracking-widest text-[10px] px-5 py-3 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Transaction
        </button>
      </div>

      {/* Searching & Filters */}
      <div className="flex flex-col md:flex-row items-center gap-4 bg-white/[0.02] p-5 border border-white/5">
        <div className="flex-1 relative w-full">
          <Search className="absolute left-4 top-3.5 w-4 h-4 text-white/30" />
          <input 
            type="text"
            placeholder="Search ledger by description or merchant..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.02] border border-white/10 rounded-none pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white placeholder:text-white/20 font-sans"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto bg-white/[0.03] border border-white/10 rounded-none px-4 py-2">
          <span className="text-[10px] font-mono text-[#F9F9F7]/40 uppercase tracking-widest font-bold">CONTAINER:</span>
          <select 
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value)}
            className="bg-transparent text-xs font-mono font-bold text-[#F9F9F7]/70 focus:outline-none cursor-pointer uppercase tracking-wider"
          >
            <option value="all" className="bg-[#121214]">All Projects</option>
            {categories.map(c => (
              <option key={c.id} value={c.id} className="bg-[#121214]">{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Transactions List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : sortedTransactions.length === 0 ? (
        <div className="bg-white/[0.01] p-16 border border-white/5 text-center">
          <Receipt className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-[#F9F9F7] font-medium text-sm">No Transactions Found</p>
          <p className="text-[#F9F9F7]/40 text-xs mt-1">Try refining search parameters or tap 'Add Transaction' to log expense.</p>
        </div>
      ) : (
        <div className="border border-white/5 bg-[#121214]/20 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-[#121214]/60 text-[#F9F9F7]/40 text-[10px] font-mono font-bold uppercase tracking-widest border-b border-white/5">
                <tr>
                  <th className="px-6 py-4">
                    <button onClick={() => toggleSort("title")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                      Title / Merchant <SortIcon field="title" />
                    </button>
                  </th>
                  <th className="px-6 py-4">
                    <button onClick={() => toggleSort("category")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                      Category <SortIcon field="category" />
                    </button>
                  </th>
                  <th className="px-6 py-4">
                    <button onClick={() => toggleSort("payer")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                      Payer <SortIcon field="payer" />
                    </button>
                  </th>
                  <th className="px-6 py-4">
                    <button onClick={() => toggleSort("classification")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                      Classification <SortIcon field="classification" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">
                    <button onClick={() => toggleSort("date")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors ml-auto">
                      Date <SortIcon field="date" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">
                    <button onClick={() => toggleSort("total")} className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors ml-auto">
                      Total Amount <SortIcon field="total" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedTransactions.map((tx) => {
                  const cat = categories.find(c => c.id === tx.categoryId);
                  const payer = participants.find(p => p.id === tx.payerId);
                  const payerName = tx.payerId === "admin" ? "Administrator" : (payer ? payer.fullName : "Unknown");

                  return (
                    <tr key={tx.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white block">{tx.title}</span>
                          {!!tx.pendingFreeInputCount && (
                            <span
                              className="text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30 px-1.5 py-0.5"
                              title="Ada item input bebas yang belum/gagal diisi peserta — total transaksi ini belum mencerminkan nominal tersebut"
                            >
                              {tx.pendingFreeInputCount} Menunggu Peserta
                            </span>
                          )}
                          {!tx.pendingFreeInputCount && tx.hasFreeInput && (
                            <span
                              className="text-[9px] font-mono font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/30 px-1.5 py-0.5"
                              title="Transaksi ini punya item yang nominalnya ditentukan sendiri oleh peserta"
                            >
                              Free Input
                            </span>
                          )}
                        </div>
                        {tx.merchant && tx.merchant !== tx.title && (
                          <span className="text-[10px] text-white/40 font-mono mt-1 block uppercase tracking-wider">{tx.merchant}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-[#F9F9F7]/70 font-sans text-xs">{cat ? cat.name : "Unknown"}</td>
                      <td className="px-6 py-4 text-[#F9F9F7]/70 text-xs font-medium">{payerName}</td>
                      <td className="px-6 py-4">
                        <span className="text-[9px] font-mono uppercase tracking-wider bg-white/5 border border-white/10 text-[#F9F9F7]/60 px-2 py-0.5 rounded-none">
                          {tx.expenseClassification || "Other"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-[#F9F9F7]/40 font-mono text-xs">{tx.date}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-white">{formatIDR(tx.total)}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => handleOpenEditModal(tx)}
                            className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors"
                            title="Edit Allocations & Invoice details"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="p-1.5 text-white/40 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                            title="Delete transaction"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* TRANSACTION MANUAL / OCR DETAILED ADD-EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-[#121214] border border-white/10 w-full max-w-4xl overflow-hidden text-left shadow-2xl my-8 relative">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div>
                <h3 className="editorial-title italic text-2xl text-white">
                  {editingId ? "Modify Split Allocation_" : "Record Expense Split_"}
                </h3>
                <p className="text-xs text-[#F9F9F7]/50 mt-1">Enter receipts manually or leverage Gemini multi-modal OCR scan.</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-[#F9F9F7]/50 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTransaction} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              
              {/* Receipt OCR Upload Drag-drop */}
              {!editingId && (
                <div className="p-6 border border-dashed border-white/10 bg-white/[0.01] text-center">
                  {scanning ? (
                    <div className="space-y-3 py-4">
                      <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
                      <p className="text-sm font-semibold text-white">Gemini OCR Multimodal extracting items...</p>
                      <p className="text-xs text-[#F9F9F7]/40 font-mono max-w-md mx-auto leading-relaxed">Wait, parsing subtotal, taxes, service charges, discounts, and line-item allocations dynamically.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 py-4">
                      <Receipt className="w-8 h-8 text-white/20 mx-auto" />
                      <div className="flex items-center gap-1.5 justify-center text-xs font-mono uppercase tracking-widest text-[#F9F9F7]/60 font-bold">
                        <span>Scan Receipt with Gemini</span>
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <label className="inline-flex items-center justify-center gap-1.5 bg-white text-black hover:bg-neutral-200 text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-2 transition-all cursor-pointer">
                        <FileUp className="w-3.5 h-3.5" />
                        Upload Receipt Image
                        <input 
                           type="file"
                           accept="image/*"
                           onChange={handleReceiptUpload}
                           className="hidden"
                        />
                      </label>
                      <p className="text-[10px] text-[#F9F9F7]/30 font-mono">Accepts JPG, JPEG, PNG, or WebP up to 5MB.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Transaction details block */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Category / Project Container *</label>
                  <select 
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-white font-mono cursor-pointer"
                  >
                    <option value="" className="bg-[#121214]">Select Category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id} className="bg-[#121214]">{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Transaction Title *</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. Lunch at Cafe"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Merchant Store / Place</label>
                  <input 
                    type="text"
                    placeholder="e.g. Starbucks Dago"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>
              </div>

              {/* Category Members Inline Manager Section */}
              <div className="bg-white/[0.01] border border-white/5 p-4 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#F9F9F7]/50">
                      Determine Bill Participants ({selectedParticipantIds.length}/{allCandidates.length})
                    </span>
                    {allCandidates.length > 0 && (
                      <div className="flex gap-1.5 text-[9px] uppercase font-bold">
                        <button
                          type="button"
                          onClick={handleSelectAllGlobalParticipants}
                          className="text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          [Select All]
                        </button>
                        <span className="text-[#F9F9F7]/20">/</span>
                        <button
                          type="button"
                          onClick={handleClearAllGlobalParticipants}
                          className="text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          [Clear All]
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedCategoryId && (
                    <button 
                      type="button"
                      onClick={() => setShowQuickAdd(!showQuickAdd)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider cursor-pointer"
                    >
                      {showQuickAdd ? "Cancel_" : "+ Link or Create Member_"}
                    </button>
                  )}
                </div>

                {selectedCategoryId ? (
                  allCandidates.length === 0 ? (
                    <div className="text-amber-400 text-[11px] bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                      No members mapped to this category yet. You must link or create at least one member to split expenses!
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 text-[11px] text-[#F9F9F7]/70 font-sans">
                      {allCandidates.map(cp => {
                        const isIncluded = selectedParticipantIds.includes(cp.id);
                        const isMapped = categoryParticipants.some(x => x.id === cp.id);
                        return (
                          <button
                            type="button"
                            key={cp.id}
                            onClick={() => handleToggleGlobalParticipant(cp.id)}
                            className={`flex items-center gap-1.5 border px-2.5 py-1.5 transition-all duration-150 cursor-pointer text-xs font-semibold ${
                              isIncluded 
                                ? "bg-blue-500/10 border-blue-500 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.1)]" 
                                : "bg-white/[0.02] border-white/10 text-slate-400 hover:border-white/20 hover:text-[#F9F9F7]"
                            }`}
                          >
                            <input 
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() => {}} // Controlled by button onClick
                              className="rounded border-white/25 bg-white/5 text-blue-500 focus:ring-0 cursor-pointer pointer-events-none"
                            />
                            <span>{cp.fullName}</span>
                            {!isMapped && (
                              <span className="text-[8px] uppercase tracking-wider font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1 py-0.5 rounded ml-1">
                                auto-link
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="text-[#F9F9F7]/30 text-[11px]">
                    Please select a category first to see or manage its split members.
                  </div>
                )}

                {showQuickAdd && selectedCategoryId && (
                  <div className="border-t border-white/5 pt-3 space-y-3 font-sans">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Link existing master participant */}
                      <div className="space-y-2">
                        <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40">Link Existing Member</label>
                        <div className="flex gap-2">
                          <select 
                            value={quickAddSelectedId}
                            onChange={(e) => setQuickAddSelectedId(e.target.value)}
                            className="flex-1 bg-white/[0.03] border border-white/10 rounded-none px-3 py-2 text-xs focus:outline-none text-white font-mono"
                          >
                            <option value="" className="bg-[#121214]">Select Member...</option>
                            {participants
                              .filter(p => !categoryParticipants.some(cp => cp.id === p.id))
                              .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }))
                              .map(p => (
                                <option key={p.id} value={p.id} className="bg-[#121214]">{p.fullName} ({p.phone})</option>
                              ))
                            }
                          </select>
                          <button
                            type="button"
                            onClick={handleQuickLinkParticipant}
                            disabled={!quickAddSelectedId}
                            className="bg-white text-black text-xs font-mono font-bold px-3 py-2 uppercase hover:bg-neutral-200 disabled:opacity-50 disabled:hover:bg-white cursor-pointer"
                          >
                            Link
                          </button>
                        </div>
                      </div>

                      {/* Create new participant inline */}
                      <div className="space-y-2">
                        <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/40 font-bold">Create & Link New Member</label>
                        <div className="flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            <input 
                              type="text"
                              placeholder="Full Name"
                              value={quickAddName}
                              onChange={(e) => setQuickAddName(e.target.value)}
                              className="bg-white/[0.03] border border-white/10 rounded-none px-3 py-2 text-xs text-white focus:outline-none"
                            />
                            <input 
                              type="text"
                              placeholder="Phone (e.g. 0812...)"
                              value={quickAddPhone}
                              onChange={(e) => setQuickAddPhone(e.target.value)}
                              className="bg-white/[0.03] border border-white/10 rounded-none px-3 py-2 text-xs text-white focus:outline-none font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleQuickCreateParticipant}
                            disabled={!quickAddName || !quickAddPhone}
                            className="w-full bg-blue-600 text-white text-xs font-mono font-bold py-2 uppercase hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 cursor-pointer text-center"
                          >
                            Create & Link Member
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Transaction Date</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Fronted Payer *</label>
                  <select 
                    value={payerId}
                    onChange={(e) => setPayerId(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-white font-mono cursor-pointer"
                  >
                    <option value="admin" className="bg-[#121214]">Administrator (You)</option>
                    {allCandidates.map(cp => (
                      <option key={cp.id} value={cp.id} className="bg-[#121214]">{cp.fullName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Classification *</label>
                  <select 
                    value={expenseClassification}
                    onChange={(e) => setExpenseClassification(e.target.value as any)}
                    required
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-white font-mono cursor-pointer"
                  >
                    <option value="" className="bg-[#121214]">Select Classification...</option>
                    <option value="Food" className="bg-[#121214]">Food & Beverage</option>
                    <option value="Transportation" className="bg-[#121214]">Transportation & Tolls</option>
                    <option value="Accommodation" className="bg-[#121214]">Accommodation/Hotel</option>
                    <option value="Entertainment" className="bg-[#121214]">Entertainment/Tickets</option>
                    <option value="Shopping" className="bg-[#121214]">Shopping/Souvenirs</option>
                    <option value="Other" className="bg-[#121214]">Other Miscellaneous</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Notes</label>
                  <input 
                    type="text"
                    placeholder="e.g. Shared equally"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/[0.05] text-[#F9F9F7] font-sans placeholder:opacity-30"
                  />
                </div>
              </div>

              {/* Interactive Line Items Sub-form */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-2">
                  <h4 className="text-[10px] font-mono font-bold text-[#F9F9F7]/40 uppercase tracking-widest">Itemized Line Allocations</h4>
                  <div className="flex items-center gap-2">
                    {formItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleAssignMembersToAllItems}
                        className="flex items-center gap-1 px-3 py-1 bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 text-blue-400 text-[10px] font-mono font-bold uppercase tracking-wider cursor-pointer"
                        title="Batch assign selected category members across all line items"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        Assign Members to All ({formItems.length}) Items
                      </button>
                    )}
                    <button 
                      type="button" 
                      onClick={addFormLineItem}
                      className="flex items-center gap-1 px-3 py-1 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-blue-400 text-[10px] font-mono font-bold uppercase tracking-wider cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      Add Item
                    </button>
                  </div>
                </div>

                {formItems.length === 0 ? (
                  <div className="text-center py-10 bg-white/[0.01] border border-dashed border-white/10">
                    <Receipt className="w-6 h-6 text-white/20 mx-auto mb-2" />
                    <p className="text-xs text-[#F9F9F7]/40 font-mono uppercase tracking-wider">No line items added yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4 divide-y divide-white/5">
                    {formItems.map((item, index) => (
                      <div key={item.id} className="pt-4 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                          <div className="md:col-span-1 text-xs font-mono font-bold text-[#F9F9F7]/30 text-center">#{index+1}</div>
                          <div className="md:col-span-3">
                            <input 
                              type="text"
                              required
                              placeholder="Item description (e.g. Nasi Goreng)"
                              value={item.name}
                              onChange={(e) => updateFormItemField(item.id, "name", e.target.value)}
                              className="w-full bg-white/[0.02] border border-white/10 rounded-none px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 placeholder:opacity-30 font-sans"
                            />
                          </div>
                          <div className="md:col-span-1">
                            <input 
                              type="number"
                              min="0.1"
                              step="any"
                              placeholder="Qty"
                              value={item.quantity || ""}
                              onChange={(e) => updateFormItemField(item.id, "quantity", Number(e.target.value))}
                              className="w-full bg-white/[0.02] border border-white/10 rounded-none px-2 py-2 text-xs text-white text-center focus:outline-none font-mono"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <input
                              type="number"
                              placeholder={item.splitMethod === "FreeInput" ? "—" : "Unit Price"}
                              disabled={item.splitMethod === "FreeInput"}
                              value={item.splitMethod === "FreeInput" ? "" : (item.unitPrice || "")}
                              onChange={(e) => updateFormItemField(item.id, "unitPrice", Number(e.target.value))}
                              className="w-full bg-white/[0.02] border border-white/10 rounded-none px-3 py-2 text-xs text-white text-right focus:outline-none font-mono disabled:opacity-30"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <select
                              value={item.splitMethod}
                              onChange={(e) => updateFormItemField(item.id, "splitMethod", e.target.value as any)}
                              className="w-full bg-white/[0.02] border border-white/10 rounded-none px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono cursor-pointer"
                            >
                              <option value="Equal" className="bg-[#121214]">Equal</option>
                              <option value="Ratio" className="bg-[#121214]">Ratio</option>
                              <option value="Percentage" className="bg-[#121214]">Percentage</option>
                              <option value="Custom" className="bg-[#121214]">Custom Amount</option>
                              <option value="Quantity" className="bg-[#121214]">Quantity</option>
                              <option value="FreeInput" className="bg-[#121214]">Free Input (Peserta Sendiri)</option>
                            </select>
                          </div>
                          <div className="md:col-span-2 text-right font-bold text-xs font-mono pr-2">
                            {item.splitMethod === "FreeInput" ? (
                              <span className="text-amber-400">Bebas oleh peserta</span>
                            ) : (
                              <span className="text-white">{formatIDR(item.lineTotal)}</span>
                            )}
                          </div>
                          <div className="md:col-span-1 text-center">
                            <button 
                              type="button" 
                              onClick={() => removeFormLineItem(item.id)}
                              className="text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <MinusCircle className="w-4 h-4 mx-auto" />
                            </button>
                          </div>
                        </div>

                        {/* Split members custom inputs & checkboxes */}
                        <div className="pl-6 py-3 px-4 bg-white/[0.01] border border-white/5 font-mono text-[11px] space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#F9F9F7]/40">
                                {item.splitMethod === "FreeInput"
                                  ? "Peserta yang mengisi nominal sendiri:"
                                  : `Allocate Split Members (${item.splitMethod} Split):`}
                              </span>
                              {selectedParticipantIds.length > 0 && (
                                <div className="flex gap-1.5 text-[9px] uppercase font-bold">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectAllItemMembers(item.id)}
                                    className="text-blue-400 hover:text-blue-300 cursor-pointer"
                                  >
                                    [Select All]
                                  </button>
                                  <span className="text-[#F9F9F7]/20">/</span>
                                  <button
                                    type="button"
                                    onClick={() => handleClearAllItemMembers(item.id)}
                                    className="text-rose-400 hover:text-rose-300 cursor-pointer"
                                  >
                                    [Clear All]
                                  </button>
                                </div>
                              )}
                            </div>
                            {item.splitMethod === "Custom" && (
                              <span className="text-[10px] text-blue-400">
                                Sum: {formatIDR(item.itemAllocations.reduce((sum, a) => sum + (a.weight || 0), 0))} / {formatIDR(item.lineTotal)}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-3">
                            {allCandidates.filter(c => selectedParticipantIds.includes(c.id)).map(cp => {
                              const alloc = item.itemAllocations.find(a => a.participantId === cp.id);
                              const isAllocated = alloc ? alloc.weight > 0 : false;
                              const weightVal = alloc ? alloc.weight : 0;

                              return (
                                <div key={cp.id} className="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2 py-1">
                                  <label className="inline-flex items-center gap-1.5 text-xs text-[#F9F9F7]/70 hover:text-white cursor-pointer select-none">
                                    <input 
                                      type="checkbox"
                                      checked={isAllocated}
                                      onChange={() => {
                                        let defaultWeight = 1;
                                        if (item.splitMethod === "Percentage") {
                                          const activeCount = item.itemAllocations.filter(a => a.weight > 0).length + (isAllocated ? -1 : 1);
                                          defaultWeight = activeCount > 0 ? Math.round(100 / activeCount) : 100;
                                        } else if (item.splitMethod === "Custom") {
                                          const activeCount = item.itemAllocations.filter(a => a.weight > 0).length + (isAllocated ? -1 : 1);
                                          defaultWeight = activeCount > 0 ? Math.round(item.lineTotal / activeCount) : item.lineTotal;
                                        }
                                        updateItemParticipantWeight(item.id, cp.id, isAllocated ? 0 : defaultWeight);
                                      }}
                                      className="border-white/20 bg-white/5 rounded-none text-blue-500 focus:ring-0 cursor-pointer text-xs"
                                    />
                                    <span className="font-sans font-medium">{cp.fullName}</span>
                                  </label>

                                  {isAllocated && item.splitMethod !== "Equal" && item.splitMethod !== "FreeInput" && (
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="any"
                                      placeholder={
                                        item.splitMethod === "Ratio" ? "Ratio" :
                                        item.splitMethod === "Percentage" ? "%" :
                                        item.splitMethod === "Custom" ? "Amount" : "Qty"
                                      }
                                      value={weightVal || ""}
                                      onChange={(e) => {
                                        updateItemParticipantWeight(item.id, cp.id, Number(e.target.value));
                                      }}
                                      className="w-16 bg-white/10 border border-white/20 rounded-none px-1.5 py-0.5 text-center text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                                    />
                                  )}

                                  {isAllocated && item.splitMethod === "FreeInput" && item.freeInputDeclarations?.[cp.id] && (
                                    <FreeInputDeclarationBadge
                                      declaration={item.freeInputDeclarations[cp.id]}
                                      formatIDR={formatIDR}
                                      onReject={() => handleRejectFreeInput(item.freeInputDeclarations![cp.id].allocationId)}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Taxes and charges totals form block */}
              <div className="border-t border-white/5 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Internal descriptions */}
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-[#F9F9F7]/50 mb-2">Extended Description</label>
                  <textarea 
                    placeholder="Enter context, receipt locations, or custom details of the spend..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-none px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-[#F9F9F7] font-sans placeholder:opacity-30 h-32 resize-none"
                  />
                </div>

                {/* Arithmetic totals block */}
                <div className="space-y-3 bg-[#121214]/60 p-5 border border-white/10 font-mono">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F9F9F7]/50">Subtotal (dynamic calculation):</span>
                    <span className="font-bold text-white">{formatIDR(subtotal)}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F9F9F7]/50">Tax (+ IDR):</span>
                    <input 
                      type="number"
                      value={tax || ""}
                      onChange={(e) => setTax(Number(e.target.value))}
                      className="w-32 bg-white/[0.03] border border-white/10 rounded-none px-3 py-1.5 text-right text-xs focus:outline-none focus:border-blue-500 text-white font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F9F9F7]/50">Service Charge (+ IDR):</span>
                    <input 
                      type="number"
                      value={serviceCharge || ""}
                      onChange={(e) => setServiceCharge(Number(e.target.value))}
                      className="w-32 bg-white/[0.03] border border-white/10 rounded-none px-3 py-1.5 text-right text-xs focus:outline-none focus:border-blue-500 text-white font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-rose-400">Discount (- IDR):</span>
                    <input 
                      type="number"
                      value={discount || ""}
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      className="w-32 bg-white/[0.03] border border-white/10 rounded-none px-3 py-1.5 text-right text-xs focus:outline-none focus:border-blue-500 text-rose-400 font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F9F9F7]/50">Other Fees (+ IDR):</span>
                    <input 
                      type="number"
                      value={otherFees || ""}
                      onChange={(e) => setOtherFees(Number(e.target.value))}
                      className="w-32 bg-white/[0.03] border border-white/10 rounded-none px-3 py-1.5 text-right text-xs focus:outline-none focus:border-blue-500 text-white font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm border-t border-white/5 pt-4">
                    <span className="font-bold text-[#F9F9F7] uppercase tracking-wider text-[11px]">Final split total:</span>
                    <span className="font-bold text-lg text-blue-400">{formatIDR(total)}</span>
                  </div>
                </div>
              </div>

              {/* Live Member Split Audit & Distribution Matrix */}
              {formItems.length > 0 && selectedParticipantIds.length > 0 && (
                <div className="mt-6 bg-[#121214] border border-blue-500/30 p-4 font-mono text-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                      <span className="font-bold uppercase text-blue-400 tracking-wider text-[11px]">
                        Live Per-Member Split Audit ({selectedParticipantIds.length} Participants Involved)
                      </span>
                    </div>
                    <span className="text-[10px] text-white/50">Proportional Tax/Fees Included</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                    {selectedParticipantIds.map((pId) => {
                      const participantObj = allCandidates.find(p => p.id === pId);
                      const name = participantObj ? participantObj.fullName : "Unknown Member";

                      // Compute item subtotal for this participant
                      let memberSubtotal = 0;
                      let memberItemsCount = 0;

                      formItems.forEach((item) => {
                        const activeAllocations = item.itemAllocations.filter(a => a.weight > 0);
                        const userAlloc = item.itemAllocations.find(a => a.participantId === pId && a.weight > 0);

                        if (userAlloc) {
                          memberItemsCount++;
                          if (item.splitMethod === "Equal") {
                            const count = activeAllocations.length;
                            if (count > 0) {
                              memberSubtotal += item.lineTotal / count;
                            }
                          } else if (item.splitMethod === "Percentage") {
                            const totalW = activeAllocations.reduce((s, a) => s + a.weight, 0);
                            if (totalW > 0) {
                              memberSubtotal += item.lineTotal * (userAlloc.weight / totalW);
                            }
                          } else if (item.splitMethod === "Custom") {
                            memberSubtotal += userAlloc.weight;
                          }
                        }
                      });

                      const netCharges = tax + serviceCharge + otherFees - discount;
                      const proportionalCharges = subtotal > 0 ? (memberSubtotal / subtotal) * netCharges : 0;
                      const memberTotal = memberSubtotal + proportionalCharges;

                      const isUnassigned = memberItemsCount === 0;

                      return (
                        <div 
                          key={pId} 
                          className={`p-2.5 border text-[11px] space-y-1 transition-colors ${
                            isUnassigned 
                              ? "bg-rose-500/10 border-rose-500/40 text-rose-300" 
                              : "bg-white/[0.02] border-white/10 text-white/90 hover:border-blue-500/50"
                          }`}
                        >
                          <div className="flex items-center justify-between font-bold">
                            <span className="truncate max-w-[120px] text-white">{name}</span>
                            <span className={isUnassigned ? "text-rose-400 font-bold" : "text-blue-400 font-bold"}>
                              {formatIDR(memberTotal)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-white/50">
                            <span>{memberItemsCount} item(s) chosen</span>
                            <span>Item sub: {formatIDR(memberSubtotal)}</span>
                          </div>
                          {isUnassigned && (
                            <div className="text-[9.5px] text-rose-400 font-bold pt-0.5">
                              ⚠️ 0 items allocated!
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Compliance & Validation Alert Banner */}
              {(() => {
                const unallocIndices = formItems
                  .map((item, idx) => ({ item, num: idx + 1 }))
                  .filter(({ item }) => item.itemAllocations.filter(a => a.weight > 0).length === 0)
                  .map(({ num }) => `#${num}`);
                
                const issues: string[] = [];
                if (!selectedCategoryId) issues.push("Category Container is not selected (*)");
                if (!date) issues.push("Transaction Date is missing (*)");
                if (!expenseClassification) issues.push("Classification is not selected (*)");
                if (formItems.length === 0) issues.push("No line items added");
                if (unallocIndices.length > 0) {
                  issues.push(`${unallocIndices.length} line item(s) (${unallocIndices.join(", ")}) have no members assigned`);
                }

                if (issues.length === 0) return null;

                return (
                  <div className="mt-6 bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs font-mono text-amber-200 space-y-2 rounded-none">
                    <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-amber-400">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>Form Compliance Checklist ({issues.length} item(s) need attention):</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-200/90 pl-1">
                      {issues.map((iss, i) => (
                        <li key={i}>{iss}</li>
                      ))}
                    </ul>
                    {unallocIndices.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleAssignMembersToAllItems}
                          className="px-2.5 py-1 bg-amber-400 text-black font-bold uppercase tracking-wider hover:bg-amber-300 cursor-pointer text-[10px]"
                        >
                          ⚡ Auto-Assign Members to All ({formItems.length}) Items
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Confirm / Save Actions */}
              <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5 mt-6 font-mono text-[10px] uppercase tracking-widest">
                <button 
                  type="button" 
                  disabled={submitting}
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-black font-bold hover:bg-neutral-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                      <span>Saving Split...</span>
                    </>
                  ) : (
                    <span>Confirm Splitting</span>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
