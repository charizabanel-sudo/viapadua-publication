"use client";

/**
 * Show/hide control for a password input. It is never a submit button, keeps the
 * value and caret when clicked with a pointer, and announces the action it will take.
 */
export default function PasswordToggle({ inputId, visible, onToggle, className = "toggle-password" }: { inputId: string; visible: boolean; onToggle: () => void; className?: string }) {
  const label = visible ? "Hide password" : "Show password";
  return (
    <button
      type="button"
      className={className}
      aria-controls={inputId}
      aria-label={label}
      title={label}
      // Pointer clicks leave focus (and the caret) in the password field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const input = document.getElementById(inputId) as HTMLInputElement | null;
        const focused = input !== null && document.activeElement === input;
        const [start, end] = [input?.selectionStart ?? null, input?.selectionEnd ?? null];
        onToggle();
        if (focused && start !== null && end !== null)
          requestAnimationFrame(() => {
            try { input.setSelectionRange(start, end); } catch { /* type switch in progress */ }
          });
      }}
    >
      <i className={`fas ${visible ? "fa-eye-slash" : "fa-eye"}`} aria-hidden="true" />
    </button>
  );
}
