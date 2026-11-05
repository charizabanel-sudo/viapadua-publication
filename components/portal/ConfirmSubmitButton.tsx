"use client";

import type { FormEventHandler, ReactNode } from "react";

export default function ConfirmSubmitButton({
  children,
  confirmMessage,
  className,
}: {
  children: ReactNode;
  confirmMessage: string;
  className?: string;
}) {
  const confirmBeforeSubmit: FormEventHandler<HTMLButtonElement> = (event) => {
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  };

  return (
    <button
      className={className}
      type="submit"
      onClick={confirmBeforeSubmit}
    >
      {children}
    </button>
  );
}