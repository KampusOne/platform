export function AgentAccessIllustration() {
  return (
    <svg aria-hidden="true" className="agent-illustration" focusable="false" viewBox="0 0 560 390">
      <rect x="18" y="24" width="524" height="342" rx="34" fill="#F1E6DC" />
      <path d="M70 308c84-58 132-82 210-82 91 0 138 42 211 83" fill="none" stroke="#D8BEAA" strokeWidth="18" strokeLinecap="round" />
      <path d="M103 215h156v91H103z" fill="#FFFDFB" stroke="#B77A5C" strokeWidth="3" />
      <path d="M90 214 181 151l91 63" fill="#D78D67" stroke="#8E4A31" strokeWidth="3" strokeLinejoin="round" />
      <rect x="157" y="250" width="47" height="56" rx="5" fill="#F0C8AF" />
      <rect x="117" y="235" width="25" height="28" rx="4" fill="#E7D6C9" />
      <rect x="219" y="235" width="25" height="28" rx="4" fill="#E7D6C9" />
      <circle cx="355" cy="163" r="37" fill="#7B4C3A" />
      <path d="M325 198c15-25 52-30 72-4 16 21 16 67 4 98h-91c-7-36-3-70 15-94Z" fill="#A8462E" />
      <path d="M337 151c6-17 31-24 47-7 8 9 8 22 2 33-10 18-39 17-49-1-5-8-5-17 0-25Z" fill="#B76A4B" />
      <rect x="381" y="216" width="76" height="58" rx="10" fill="#FFFDFB" stroke="#8E4A31" strokeWidth="3" />
      <path d="M399 216v-12c0-11 9-20 20-20h2c11 0 20 9 20 20v12" fill="none" stroke="#8E4A31" strokeWidth="3" />
      <rect x="297" y="235" width="42" height="57" rx="8" fill="#F6DFC9" stroke="#8E4A31" strokeWidth="3" />
      <path d="M305 247h26M305 258h18M305 269h23" stroke="#A8462E" strokeWidth="3" strokeLinecap="round" />
      <circle cx="473" cy="102" r="34" fill="#E3B291" />
      <path d="M473 82v40M453 102h40" stroke="#8E4A31" strokeWidth="4" strokeLinecap="round" />
      <path d="M75 92h118" stroke="#8E4A31" strokeWidth="9" strokeLinecap="round" />
      <path d="M75 116h82" stroke="#B77A5C" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

export function AgentApplicationIllustration({ complete = false }: { complete?: boolean }) {
  return (
    <svg aria-hidden="true" className="agent-illustration agent-application-illustration" focusable="false" viewBox="0 0 520 320">
      <rect x="22" y="22" width="476" height="276" rx="30" fill="#F2E7DD" />
      <rect x="72" y="76" width="150" height="166" rx="18" fill="#FFFDFB" stroke="#D8BEAA" strokeWidth="3" />
      <rect x="92" y="100" width="94" height="11" rx="5.5" fill="#A8462E" />
      <rect x="92" y="126" width="108" height="8" rx="4" fill="#DDC9BA" />
      <rect x="92" y="146" width="86" height="8" rx="4" fill="#DDC9BA" />
      <rect x="92" y="178" width="110" height="42" rx="10" fill="#F4D6C3" />
      <circle cx="324" cy="118" r="45" fill="#D78D67" />
      <path d="M283 186c21-40 72-47 101-12 17 21 23 48 18 68H268c-1-19 4-39 15-56Z" fill="#8E4A31" />
      <path d="M304 112c3-24 39-33 55-12 9 12 8 28-1 40-15 19-48 13-54-11-2-6-2-12 0-17Z" fill="#B76A4B" />
      {complete ? (
        <>
          <circle cx="416" cy="82" r="36" fill="#E1B292" />
          <path d="m398 82 12 13 25-30" fill="none" stroke="#5C382B" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <rect x="386" y="54" width="76" height="56" rx="13" fill="#FFFDFB" stroke="#B77A5C" strokeWidth="3" />
          <path d="M404 71h39M404 84h30M404 97h35" stroke="#A8462E" strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      <path d="M248 264h194" stroke="#D8BEAA" strokeWidth="10" strokeLinecap="round" />
      <circle cx="268" cy="264" r="13" fill="#A8462E" />
      <circle cx="342" cy="264" r="13" fill="#D78D67" />
      <circle cx="416" cy="264" r="13" fill="#B77A5C" />
    </svg>
  );
}
