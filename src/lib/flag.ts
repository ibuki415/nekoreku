// 国コード（JP など）→ 国旗の絵文字。地域指示子（regional indicator）の2文字で作る
export function flagEmoji(countryCode: string): string {
  const cc = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
