/**
 * The 8 hotel branches, in dispatch-menu order.
 *
 * `hotelName` is the name as it appears in Booking.com text and is the string
 * the Phase 3 branch matcher compares against — keep it verbatim, including
 * truncations like "Ben Than" and "Luxur" that Booking.com itself produces.
 */
export interface BranchSeed {
  code: string;
  hotelName: string;
  address: string;
}

export const BRANCHES: readonly BranchSeed[] = [
  {
    code: 'TRUONG_DINH_05',
    hotelName: 'Saigon Hotel & Ben Thanh',
    address: '05 Trương Định',
  },
  {
    code: 'LY_TU_TRONG_260',
    hotelName: 'Luxury Elegance Hotel Ben Than',
    address: '260 Lý Tự Trọng',
  },
  {
    code: 'NGUYEN_TRAI_47A',
    hotelName: 'Luxury Ancient Boutique Hotel',
    address: '47A Nguyễn Trãi',
  },
  {
    code: 'NGUYEN_THAI_BINH_170',
    hotelName: 'INDOCHINA Premium',
    address: '170-172-174 Nguyễn Thái Bình',
  },
  {
    code: 'LE_THANH_TON_278',
    hotelName: 'Boutique Zody Hotel Ben Than',
    address: '278 Lê Thánh Tôn',
  },
  {
    code: 'BUI_THI_XUAN_40',
    hotelName: 'Ben Thanh Market - Luxur',
    address: '40-42 Bùi Thị Xuân',
  },
  {
    code: 'BUI_THI_XUAN_13',
    hotelName: 'Modern Luxury Eliana Hotel',
    address: '13 Bùi Thị Xuân',
  },
  {
    code: 'LE_THANH_TON_191',
    hotelName: 'Modern Luxury Dilly Hotel',
    address: '191 Lê Thánh Tôn',
  },
] as const;

export const BRANCH_COUNT = BRANCHES.length;
