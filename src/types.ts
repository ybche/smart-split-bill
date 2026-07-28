export interface Admin {
  id: string;
  email: string;
  passwordHash: string;
  settings: AdminSettings;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSettings {
  currency: string; // e.g. "IDR"
  locale: string; // e.g. "id-ID"
  timezone: string; // e.g. "Asia/Jakarta"
  requireProof: boolean;
  roundingPolicy: 'rupiah_default' | 'none';
}

export interface Category {
  id: string;
  name: string;
  description: string;
  startDate?: string;
  endDate?: string;
  imageUrl?: string;
  status: 'Draft' | 'Ongoing' | 'Completed' | 'Archived';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: string;
  fullName: string;
  normalizedPhone: string;
  email?: string;
  nickname?: string;
  notes?: string;
  introductionState: 'NeverOpened' | 'Opened' | 'ManuallyMarkedSent';
  createdSource: 'manual' | 'transaction';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryParticipant {
  id: string;
  categoryId: string;
  participantId: string;
  personalToken: string;
  tokenState: 'Active' | 'Revoked' | 'Expired';
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  categoryId: string;
  title: string;
  merchant: string;
  date: string;
  payerId: string; // administrator or participantId
  inputMethod: 'manual' | 'ocr';
  receiptUrl?: string;
  subtotal: number; // in integer Rupiah
  tax: number; // in integer Rupiah
  serviceCharge: number; // in integer Rupiah
  discount: number; // in integer Rupiah (stored as positive, subtracted in calculations)
  otherFees: number; // in integer Rupiah
  total: number; // in integer Rupiah, must equal subtotal + tax + serviceCharge + otherFees - discount
  status: 'Draft' | 'Confirmed';
  expenseClassification: 'Food' | 'Transportation' | 'Accommodation' | 'Entertainment' | 'Shopping' | 'Other';
  description?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // Count of this transaction's free-input item declarations awaiting admin
  // review (status='Pending'). Only present on the list endpoint response.
  pendingFreeInputCount?: number;
  hasFreeInput?: boolean;
}

export interface TransactionItem {
  id: string;
  transactionId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  classification: 'Food' | 'Transportation' | 'Accommodation' | 'Entertainment' | 'Shopping' | 'Other';
  sortOrder: number;
}

export interface Allocation {
  id: string;
  transactionId: string;
  itemId?: string; // empty means proportional charge (tax/serviceCharge/discount/etc)
  chargeType?: 'tax' | 'serviceCharge' | 'discount' | 'otherFees';
  participantId: string;
  method: 'Equal' | 'Ratio' | 'Percentage' | 'Custom' | 'Quantity' | 'Hybrid';
  inputs?: number; // ratio value, percentage value, custom amount etc
  rawAmount: number;
  roundedAmount: number;
}

export interface PaymentMethod {
  id: string;
  type: 'bank' | 'wallet' | 'cash' | 'custom';
  name: string; // e.g. "Bank Mandiri" or "GoPay"
  accountHolder: string;
  accountNumber: string; // or Phone/Wallet ID
  imageUrl?: string; // QRIS image url
  instructions?: string;
  notes?: string;
  enabled: boolean;
  preferred: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSubmission {
  id: string;
  categoryId: string;
  participantId: string;
  methodSnapshot: any; // snapshot of PaymentMethod at submission
  selectedObligations: string[]; // transactionIds being paid
  submittedAmount: number;
  proofUrl?: string; // Base64 or local image URL
  status: 'Pending Verification' | 'Paid' | 'Partially Paid' | 'Failed' | 'Rejected';
  notes?: string;
  rejectionReason?: string;
  referenceNumber?: string;
  submissionDate: string;
  verificationDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocation {
  id: string;
  paymentSubmissionId: string;
  transactionId: string;
  amount: number;
}

export interface MessageAction {
  id: string;
  participantId: string;
  categoryId: string;
  type: 'introduction' | 'reminder';
  generatedMessage: string;
  link: string;
  openedAt?: string;
  manuallyMarkedSentAt?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  entityType: 'category' | 'transaction' | 'participant' | 'payment' | 'token' | 'method';
  entityId: string;
  action: string; // e.g., "created", "updated", "deleted", "approved", "rejected", "reminder_sent"
  actorType: 'admin' | 'participant';
  metadata?: any;
  createdAt: string;
}
