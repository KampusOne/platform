/** Normalize common number separators without treating prices/course codes as
 * contacts. A contact restriction is a conversation policy, never account auth. */
export function containsContactDetails(body:string) {
 const normalized=body.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'');
 if(/\b(?:wa\.me|api\.whatsapp\.com|t\.me)\//i.test(normalized))return true;
 const words:Record<string,string>={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',oh:'0'};
 const numbers=normalized.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/gi,word=>words[word.toLowerCase()]!);
 return /(?:^|[^\d])(?:\+?234[ .()-]*[789](?:[ .()-]*\d){9}|0[ .()-]*[789](?:[ .()-]*\d){9}|\d(?:[ .()-]*\d){9})(?![ .()-]*\d)/.test(numbers);
}
