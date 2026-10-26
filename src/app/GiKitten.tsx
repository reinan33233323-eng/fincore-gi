/** Small decorative mascot; kept outside financial controls and values. */
export default function GiKitten({ className = "" }: { className?: string }) {
  return <svg aria-hidden="true" focusable="false" className={`gi-kitten ${className}`} viewBox="0 0 120 100" fill="none">
    <path d="M28 73C12 82 9 63 20 61" stroke="#d880a6" strokeWidth="6" strokeLinecap="round"/>
    <ellipse cx="61" cy="76" rx="30" ry="17" fill="#f7c7dc"/>
    <path d="M29 44L26 12Q26 7 31 10L49 24Q60 20 72 24L91 10Q96 7 94 14L91 45" fill="#fff8fc" stroke="#b65a80" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M32 18L34 34L44 27M86 18L82 34L77 27" fill="#f5aacb"/>
    <ellipse cx="60" cy="48" rx="34" ry="28" fill="#fff8fc" stroke="#b65a80" strokeWidth="2.5"/>
    <path d="M42 45Q46 40 50 45M70 45Q74 40 78 45" stroke="#87415f" strokeWidth="2.8" strokeLinecap="round"/>
    <ellipse cx="38" cy="53" rx="7" ry="4" fill="#f8b5d1"/><ellipse cx="82" cy="53" rx="7" ry="4" fill="#f8b5d1"/>
    <path d="M57 51Q60 48 63 51L60 55Z" fill="#d4739e"/>
    <path d="M60 55Q56 61 52 56M60 55Q64 61 68 56" stroke="#87415f" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M22 48L34 50M21 56L33 55M87 50L99 48M88 55L100 56" stroke="#d58dad" strokeWidth="1.7" strokeLinecap="round"/>
    <ellipse cx="46" cy="84" rx="11" ry="6" fill="#fff8fc"/><ellipse cx="75" cy="84" rx="11" ry="6" fill="#fff8fc"/>
    <path d="M59 73L49 67V79L59 75L69 79V67Z" fill="#dc70a3"/><circle cx="59" cy="74" r="3" fill="#b94b80"/>
    <path d="M107 28V38M102 33H112M12 24V30M9 27H15" stroke="#e9a1c4" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}
