import React from 'react';
import { EnrichedMessage } from '../types';

interface EmailCardProps {
  email: EnrichedMessage;
  onToggle: (id: string) => void;
}

const EmailCard: React.FC<EmailCardProps> = ({ email, onToggle }) => {
  // No longer needed

  return (
    <div
      onClick={() => onToggle(email.id)}
      className={`
        p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative overflow-hidden
        ${email.selected
          ? 'bg-indigo-900/30 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
        }
      `}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Checkbox */}
        <div className={`
          mt-1 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors
          ${email.selected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-500 group-hover:border-slate-400'}
        `}>
          {email.selected && (
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1">
            <h3 className="font-semibold text-slate-200 truncate pr-2 text-sm">{email.from}</h3>
            <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(email.timestamp).toLocaleDateString()}</span>
          </div>
          <p className="text-sm font-medium text-white truncate mb-1">{email.subject}</p>
          <p className="text-xs text-slate-400 line-clamp-2">{email.snippet}</p>

        </div>
      </div>
    </div>
  );
};

export default EmailCard;
