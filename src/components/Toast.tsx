'use client';

import React from 'react';
import { useToast, ToastMessage, ToastType } from '@/lib/toast';

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

const assertiveTypes: ReadonlySet<ToastType> = new Set<ToastType>(['error', 'warning']);

// Errors interrupt; everything else waits for a pause. The item role and the region's politeness
// must agree, otherwise an assertive item inside a polite region is swallowed by some screen
// readers while others double-announce it.
function getToastRole(type: ToastType): 'alert' | 'status' {
  return assertiveTypes.has(type) ? 'alert' : 'status';
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const getToastStyles = (type: ToastType): string => {
    const baseStyles = "flex items-center p-4 mb-3 rounded-lg shadow-lg max-w-sm w-full transition-all duration-300 ease-in-out border";
    
    switch (type) {
      case 'success':
        return `${baseStyles} bg-surface border-success/30 text-success`;
      case 'error':
        return `${baseStyles} bg-surface border-danger/30 text-danger`;
      case 'warning':
        return `${baseStyles} bg-surface border-warning/30 text-warning`;
      case 'info':
        return `${baseStyles} bg-surface border-primary/30 text-primary`;
      default:
        return `${baseStyles} bg-surface border-border text-text-primary`;
    }
  };

  const getIcon = (type: ToastType): string => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return '•';
    }
  };

  return (
    <div className={getToastStyles(toast.type)} role={getToastRole(toast.type)}>
      <div
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-current bg-opacity-10 text-sm font-bold mr-3"
        aria-hidden="true"
      >
        {getIcon(toast.type)}
      </div>
      <div className="flex-1 text-sm font-medium text-text-primary">
        {toast.message}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 ml-3 text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Close notification"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    // The region is always mounted, even when empty. A live region that is inserted into the DOM
    // at the same moment as its first message is frequently not announced at all, because the
    // assistive technology has not registered the region yet. `aria-relevant="additions"` limits
    // announcements to newly added toasts, so removing one does not re-read the rest.
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="fixed top-4 right-4 z-50 space-y-2"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={removeToast}
        />
      ))}
    </div>
  );
}

export default ToastContainer;