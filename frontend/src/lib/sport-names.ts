// Display names only; exact API/training labels remain unchanged.
export const sportNamesVi: Readonly<Record<string, string>> = {
  archery: 'Bắn cung',
  baseball: 'Bóng chày',
  basketball: 'Bóng rổ',
  boxing: 'Quyền anh',
  'canoe slamon': 'Đua thuyền vượt chướng ngại vật',
  'field hockey': 'Khúc côn cầu trên cỏ',
  'figure skating pairs': 'Trượt băng nghệ thuật đôi',
  'figure skating women': 'Trượt băng nghệ thuật nữ',
  football: 'Bóng bầu dục Mỹ',
  'formula 1 racing': 'Đua xe Công thức 1',
  golf: 'Đánh gôn',
  'high jump': 'Nhảy cao',
  hockey: 'Khúc côn cầu trên băng',
  'nascar racing': 'Đua xe NASCAR',
  'olympic wrestling': 'Đấu vật Olympic',
  polo: 'Mã cầu',
  rings: 'Thể dục vòng treo',
  'roller derby': 'Trượt patin đối kháng',
  'rollerblade racing': 'Đua patin',
  rugby: 'Bóng bầu dục',
  soccer: 'Bóng đá',
  swimming: 'Bơi lội',
  tennis: 'Quần vợt',
  'uneven bars': 'Thể dục xà lệch',
  volleyball: 'Bóng chuyền',
}

const sportNameAliasesVi: Readonly<Record<string, string>> = {
  'american football': 'Bóng bầu dục Mỹ',
}

export function sportNameVi(label: string): string {
  if (Object.hasOwn(sportNamesVi, label)) return sportNamesVi[label]
  if (Object.hasOwn(sportNameAliasesVi, label)) return sportNameAliasesVi[label]
  return label
}

export function splitSportLabel(label: string): { display: string; raw: string | null } {
  const display = sportNameVi(label)
  return { display, raw: display !== label ? label : null }
}
