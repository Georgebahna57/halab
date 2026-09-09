export type FundId = 'steelMax' | 'georgeAbuAyyoun' | 'halabJadida' | 'moneyOut' | 'marakiz';

export type Currency =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CAD'
  | 'SAR'
  | 'QAR'
  | 'KWD'
  | 'JOD'
  | 'AED'
  | 'SYP'
  | 'NSYP'
  | 'LBP'
  | 'GOLD'
  | 'SILVER';

export type TransactionStatus = 'posted' | 'pending';
export type TransactionKind = 'receipt' | 'payment' | 'exchange';
export type TransactionLedger = 'fund' | 'account';
export type FeeMode = 'fixed' | 'percent' | 'per_mille';
export type FeeSide = 'ours' | 'customer';

export interface Fund {
  id: FundId;
  name: string;
  shortName: string;
  accent: string;
}

export interface Customer {
  id: string;
  fundId: FundId;
  name: string;
  /** رقم الحساب — من نظام المحاسبة (مثل 4011-1114) */
  accountNumber?: string;
  phone?: string;
  note?: string;
  /** صناديق إضافية يظهر فيها الحساب (غير صندوقه الأساسي) */
  sharedFundIds?: FundId[];
  /** مطابقة — كل الحركات حتى هذا التاريخ (شامل) تُعتبر مطابقة */
  reconciliation?: AccountReconciliation;
  /** مراكز أو زبائن — ليس تبعيّة لصندوق نمر/حلب */
  accountBranch?: AccountBranchId;
  createdAt: string;
}

export interface AccountReconciliation {
  throughDate: string;
  markedAt: string;
  markedByName?: string;
}

/** حقول حوالة إضافية — صندوق حلب - الفيلات */
export interface HalabRemittanceFields {
  transferDate?: string;
  companyName?: string;
  publicNumber?: string;
  sender?: string;
  beneficiary?: string;
  beneficiaryPhone?: string;
  deliveryAmount?: string;
  deliveryCurrency?: Currency;
  destination?: string;
}

export interface Transaction {
  id: string;
  fundId: FundId;
  /** fund = حركة على حساب الصندوق | account = حركة على حساب زبون */
  ledger: TransactionLedger;
  date: string;
  currency: Currency;
  kind: TransactionKind;
  amount: number;
  /** صاحب الحساب — حساب الصندوق أو حساب زبون */
  party: string;
  /** الطرف الآخر (من / لـ) — للعرض فقط */
  counterparty?: string;
  intermediary?: string;
  /** أجور / عمولة — نص العرض (قد يحتوي بيانات منظمة) */
  fee?: string;
  feeMode?: FeeMode;
  feeRate?: number;
  feeSide?: FeeSide;
  feeAmount?: number;
  feeCurrency?: Currency;
  /** عمولات شاملة — كندا ونور فقط → حساب «عمولات شاملة» */
  extraFee?: string;
  extraFeeMode?: FeeMode;
  extraFeeRate?: number;
  extraFeeSide?: FeeSide;
  extraFeeAmount?: number;
  extraFeeCurrency?: Currency;
  note?: string;
  status: TransactionStatus;
  createdAt: string;
  /** يربط عدة بنود ضمن عملية واحدة */
  batchId?: string;
  /** يربط حركة الصندوق مع حركة الحساب */
  linkId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  createdByName?: string;
  lastEditedAt?: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  editHistory?: TransactionEditRecord[];
  exchangeToCurrency?: Currency;
  exchangeRate?: number;
  exchangeToAmount?: number;
  /** يربط حركة الأجور التلقائية بالعملية الأصلية على الصندوق */
  feeSourceId?: string;
  /** نص رسالة واتساب عند الإرسال من قيد الانتظار */
  pendingWhatsAppMessage?: string;
  approvalDetails?: string;
  approvedByName?: string;
  approvedByEmail?: string;
  approvedAt?: string;
  /** تاريخ إنشاء الطلب بقيد الانتظار — يبقى بعد الاعتماد للعرض */
  orderedDate?: string;
  /** بيانات حوالة — حلب - الفيلات */
  halabRemittance?: HalabRemittanceFields;
  /** موظف يتابع اعتماد/معالجة العملية */
  claimedByUserId?: string;
  claimedByName?: string;
  claimedAt?: string;
  comments?: TransactionComment[];
}

export interface TransactionComment {
  id: string;
  text: string;
  at: string;
  byUserId?: string;
  byName?: string;
  byEmail?: string;
  mentions?: string[];
}

export interface Bill {
  id: string;
  fundId: FundId;
  invoiceNo: string;
  description: string;
  amount?: number;
  currency?: Currency;
  paidAt?: string;
  createdAt: string;
}

export interface CurrencyBalance {
  receipts: number;
  payments: number;
  balance: number;
}

export type FundBalances = Record<Currency, CurrencyBalance>;

export interface CustomerCurrencyBalance {
  receipts: number;
  payments: number;
  balance: number;
}

export type CustomerBalances = Record<Currency, CustomerCurrencyBalance>;

export interface CustomerSummary {
  name: string;
  customerId?: string;
  accountNumber?: string;
  /** صندوق الحساب (الأساسي عند الدمج) */
  fundId?: FundId;
  /** صناديق مرتبطة بعد دمج حسابات بنفس الاسم */
  fundIds?: FundId[];
  /** أسماء أصلية قبل التوحيد (كندا / canada…) */
  aliases?: string[];
  /** حساب مجمّع من أكثر من صندوق */
  merged?: boolean;
  sharedFundIds?: FundId[];
  reconciliation?: AccountReconciliation;
  balances: CustomerBalances;
  hasActivity: boolean;
}

export interface AppState {
  transactions: Transaction[];
  bills: Bill[];
  customers: Customer[];
}

export type ViewId = 'ledger' | 'pending' | 'customers' | 'bills';

/** القسم الرئيسي: عمليات الصناديق أو حسابات ومطابقات */
export type AppSectionId = 'funds' | 'accounts';

/** فرع الحسابات: مراكز أو زبائن */
export type AccountBranchId = 'centers' | 'customers';

export interface TransactionEditRecord {
  at: string;
  byName?: string;
  byEmail?: string;
  summary: string;
}

export interface TransactionFilters {
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  currency?: Currency | '';
}
