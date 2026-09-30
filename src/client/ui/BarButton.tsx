import type { ButtonHTMLAttributes } from 'react';

export function BarButton({ children, arrow = true, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { arrow?: boolean }) {
  return (
    <button type="button" className={`bar ${className ?? ''}`} {...rest}>
      <span>{children}</span>
      {arrow && <span aria-hidden="true">→</span>}
    </button>
  );
}
