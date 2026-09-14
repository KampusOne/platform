"use client";
import { useEffect, useState } from "react";
export function TransientNotice({ message }: { message: string }) {
  return message ? <Notice key={message} message={message} /> : null;
}
function Notice({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <div role="status" className="transient-notice">
      {message}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  ) : null;
}
