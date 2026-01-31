import React from 'react';
import { EnrichedMessage } from '../types';

interface EmailCardProps {
  email: EnrichedMessage;
  onToggle: (id: string) => void;
}

const EmailCard: React.FC<EmailCardProps> = ({ email, onToggle }) => {
  return (
    <div
      onClick={() => onToggle(email.id)}
      className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative overflow-hidden ${email.selected
          ? 'bg-black border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
          : 'bg-black border-white/10 hover:border-white/30'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Checkbox */}
        <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${email.selected ? 'bg-white border-white' : 'border-white/20 group-hover:border-white/40'
          }`}>
          {email.selected && (
            <svg className="w-3.5 h-3.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1">
            <h3 className="font-semibold text-white truncate pr-2 text-sm">{email.from}</h3>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-white/40 whitespace-nowrap">{email.date}</span>
              {email.labelAddedAt && (
                <span className="action-time-badge">
                  Added @ {new Date(email.labelAddedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
          <p className="text-sm font-medium text-white truncate mb-1">{email.subject}</p>
          <p className="text-xs text-white/60 line-clamp-2">{email.snippet}</p>
        </div>
      </div>
    </div>
  );
};

export default EmailCard;
