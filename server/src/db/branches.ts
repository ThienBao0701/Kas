/**
 * The initial hotel branches, in dispatch-menu order.
 *
 * This is the *starting* configuration only. Since Milestone C.3.7 branches are
 * Admin-managed at runtime (add, rename, renumber, re-address, activate), so
 * nothing in the application may assume this list is complete or fixed at 8 —
 * always read branches from the database.
 *
 * `hotelName` is the branch's internal display name, which for these eight is
 * also their original Booking.com name — keep it verbatim, including truncations
 * like "Ben Than" and "Luxur" that Booking.com itself produces. Platform names
 * are seeded into `BranchSourceAlias` (see `seed.ts`).
 *
 * `branchNumber` is the human-readable "Chi nhánh N" the operator uses. It is a
 * value, not a position: it is stored per branch and may be edited later.
 */
export interface BranchSeed {
  code: string;
  hotelName: string;
  address: string;
  branchNumber: number;
}

export const BRANCHES: readonly BranchSeed[] = [
  {
    code: 'TRUONG_DINH_05',
    hotelName: 'Saigon Hotel & Ben Thanh',
    address: '05 Trương Định',
    branchNumber: 1,
  },
  {
    code: 'LY_TU_TRONG_260',
    hotelName: 'Luxury Elegance Hotel Ben Than',
    address: '260 Lý Tự Trọng',
    branchNumber: 2,
  },
  {
    code: 'NGUYEN_TRAI_47A',
    hotelName: 'Luxury Ancient Boutique Hotel',
    address: '47A Nguyễn Trãi',
    branchNumber: 3,
  },
  {
    code: 'NGUYEN_THAI_BINH_170',
    hotelName: 'INDOCHINA Premium',
    address: '170-172-174 Nguyễn Thái Bình',
    branchNumber: 4,
  },
  {
    code: 'LE_THANH_TON_278',
    hotelName: 'Boutique Zody Hotel Ben Than',
    address: '278 Lê Thánh Tôn',
    branchNumber: 5,
  },
  {
    code: 'BUI_THI_XUAN_40',
    hotelName: 'Ben Thanh Market - Luxur',
    address: '40-42 Bùi Thị Xuân',
    branchNumber: 6,
  },
  {
    code: 'BUI_THI_XUAN_13',
    hotelName: 'Modern Luxury Eliana Hotel',
    address: '13 Bùi Thị Xuân',
    branchNumber: 7,
  },
  {
    code: 'LE_THANH_TON_191',
    hotelName: 'Modern Luxury Dilly Hotel',
    address: '191 Lê Thánh Tôn',
    branchNumber: 8,
  },
] as const;

export const BRANCH_COUNT = BRANCHES.length;
